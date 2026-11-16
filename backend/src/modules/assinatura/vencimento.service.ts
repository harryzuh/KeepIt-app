import { ACOES_AUDITORIA, registrarAuditoria } from '../../lib/auditoria.js';
import { adicionarMeses } from '../../lib/datas.js';
import { comNovasTentativas } from '../../lib/concorrencia.js';
import { descreverErro } from '../../lib/erro-log.js';
import { prisma } from '../../lib/prisma.js';
import { emailAssinaturaExpiradaAdmin, emailMembroDesvinculado } from './assinatura.email.js';
import { travarCasa } from '../casa/casa.service.js';
import { moverParaCasaNova } from './casa-nova.js';
import { cobrarSimulado } from './gateway-simulado.js';

/**
 * MODEL · Rotina de vencimento das assinaturas (RF37, ADR 0002 D6). Chamada de hora em hora por `POST /internal/jobs`.
 * - CANCELADA vencida: EXPIRADA (motivo CANCELAMENTO).
 * - ATIVA vencida: renova (mesmo registro, +1 mês de calendário) se a cobrança simulada for aprovada;
 *   senão EXPIRADA (motivo RECUSA).
 * Expirar devolve a Casa ao Individual: o ADMIN fica e cada membro extra ganha Casa própria. Produtos são mantidos.
 * Cada assinatura roda em transação própria, com `updateMany` condicional: idempotente e segura em execuções concorrentes.
 */

export const LIMITE_POR_EXECUCAO = 200;

type Motivo = 'CANCELAMENTO' | 'RECUSA';

export interface ResultadoVencimentos {
  expiradas: number;
  renovadas: number;
  /** Assinaturas que falharam nesta execução (serão reprocessadas na próxima). Zero é o esperado. */
  falhas: number;
}

interface Aviso {
  expirada: { adminEmail: string; adminNome: string; plano: string; desvinculados: number };
  membros: { email: string; nome: string; casaNova: string }[];
}

type Desfecho = { tipo: 'ignorada' } | { tipo: 'renovada' } | { tipo: 'expirada'; aviso: Aviso };

async function processarUma(id: number, agora: Date): Promise<Desfecho> {
  // A Casa é travada (como adicionar, remover, excluir conta e assinar) ANTES de reler status e membros: sem isso,
  // um `adicionarMembro` que ainda viu a assinatura vigente poderia ser confirmado depois do job e deixar a Casa
  // Individual com um membro a mais para sempre. Só a leitura do `casaId` é feita sem trava.
  const previa = await prisma.assinatura.findUnique({ where: { id }, select: { casaId: true } });
  if (!previa) return { tipo: 'ignorada' };
  return prisma.$transaction(async (tx) => {
    await travarCasa(tx, previa.casaId);
    const a = await tx.assinatura.findUnique({ where: { id }, include: { plano: true } });
    if (!a || a.casaId !== previa.casaId || !['ATIVA', 'CANCELADA'].includes(a.status) || a.dataRenovacao.getTime() > agora.getTime()) {
      return { tipo: 'ignorada' };
    }

    let motivo: Motivo;
    if (a.status === 'CANCELADA') {
      motivo = 'CANCELAMENTO';
    } else {
      const metodo = a.titularId
        ? await tx.metodoPagamento.findUnique({ where: { usuarioId: a.titularId } })
        : null;
      const cobranca = cobrarSimulado(metodo?.ultimos4);
      if (cobranca.aprovado) {
        // Parte da data anterior (não perde dias); se a rotina ficou parada, soma meses até passar de "agora".
        let proxima = adicionarMeses(a.dataRenovacao, 1);
        while (proxima.getTime() <= agora.getTime()) proxima = adicionarMeses(proxima, 1);
        const r = await tx.assinatura.updateMany({
          where: { id, status: 'ATIVA', dataRenovacao: { lte: agora } },
          data: { dataRenovacao: proxima, refPagamento: cobranca.referencia },
        });
        if (r.count !== 1) return { tipo: 'ignorada' };
        await registrarAuditoria(
          {
            casaId: a.casaId,
            acao: ACOES_AUDITORIA.ASSINATURA_RENOVADA,
            entidade: 'Assinatura',
            entidadeId: id,
            detalhes: { de: a.dataRenovacao.toISOString(), para: proxima.toISOString() },
          },
          tx,
        );
        return { tipo: 'renovada' };
      }
      motivo = 'RECUSA';
    }

    const r = await tx.assinatura.updateMany({
      where: { id, status: a.status, dataRenovacao: { lte: agora } },
      data: { status: 'EXPIRADA', motivoEncerramento: motivo, encerradaEm: agora },
    });
    if (r.count !== 1) return { tipo: 'ignorada' };

    // RF37: o ADMIN permanece; cada membro extra recebe uma Casa própria (Individual comporta 1 membro).
    const extras = await tx.membro.findMany({
      where: { casaId: a.casaId, papel: { not: 'ADMIN' } },
      include: { usuario: true },
      orderBy: [{ entrouEm: 'asc' }, { id: 'asc' }],
    });
    const membros: Aviso['membros'] = [];
    for (const m of extras) {
      const casaNova = await moverParaCasaNova(tx, m.usuario, a.casaId);
      await registrarAuditoria(
        { casaId: a.casaId, acao: ACOES_AUDITORIA.MEMBRO_REMOVIDO, entidade: 'Usuario', entidadeId: m.usuarioId, detalhes: { motivo: 'ASSINATURA_EXPIRADA', casaNovaId: casaNova.id } },
        tx,
      );
      await registrarAuditoria(
        { usuarioId: m.usuarioId, casaId: casaNova.id, acao: ACOES_AUDITORIA.CASA_CRIADA, entidade: 'Casa', entidadeId: casaNova.id, detalhes: { origem: 'ASSINATURA_EXPIRADA' } },
        tx,
      );
      membros.push({ email: m.usuario.email, nome: m.usuario.nome, casaNova: casaNova.nome });
    }
    await registrarAuditoria(
      { casaId: a.casaId, acao: ACOES_AUDITORIA.ASSINATURA_EXPIRADA, entidade: 'Assinatura', entidadeId: id, detalhes: { motivo, membrosDesvinculados: membros.length } },
      tx,
    );
    const admin = await tx.membro.findFirst({ where: { casaId: a.casaId, papel: 'ADMIN' }, include: { usuario: true } });
    return {
      tipo: 'expirada',
      aviso: {
        expirada: {
          adminEmail: admin?.usuario.email ?? '',
          adminNome: admin?.usuario.nome ?? '',
          plano: a.plano.nome,
          desvinculados: membros.length,
        },
        membros,
      },
    };
  });
}

/** Processa até `LIMITE_POR_EXECUCAO` assinaturas vencidas, das mais antigas para as mais novas. */
export async function processarVencimentos(agora = new Date()): Promise<ResultadoVencimentos> {
  const vencidas = await prisma.assinatura.findMany({
    where: { status: { in: ['ATIVA', 'CANCELADA'] }, dataRenovacao: { lte: agora } },
    orderBy: { dataRenovacao: 'asc' },
    take: LIMITE_POR_EXECUCAO,
    select: { id: true },
  });
  const resultado: ResultadoVencimentos = { expiradas: 0, renovadas: 0, falhas: 0 };
  for (const { id } of vencidas) {
    try {
      const desfecho = await comNovasTentativas(() => processarUma(id, agora));
      if (desfecho.tipo === 'renovada') resultado.renovadas += 1;
      if (desfecho.tipo === 'expirada') {
        resultado.expiradas += 1;
        const { expirada, membros } = desfecho.aviso;
        if (expirada.adminEmail) {
          await emailAssinaturaExpiradaAdmin(expirada.adminEmail, expirada.adminNome, expirada.plano, expirada.desvinculados);
        }
        for (const m of membros) await emailMembroDesvinculado(m.email, m.nome, m.casaNova);
      }
    } catch (err) {
      // A falha de uma assinatura não impede as demais; ela é reprocessada na execução seguinte (log sem dados pessoais).
      resultado.falhas += 1;
      console.error(`Falha ao processar assinatura ${id}:`, descreverErro(err));
    }
  }
  // Alerta (fail-open): a rotina nunca derruba o job, mas falhas precisam chegar a quem monitora os logs/Actions.
  if (resultado.falhas > 0) {
    console.error(`ALERTA expirarAssinaturas: ${resultado.falhas} de ${vencidas.length} assinatura(s) falharam e ficaram pendentes`);
  }
  return resultado;
}
