import type { Prisma } from '@prisma/client';
import { ACOES_AUDITORIA, registrarAuditoria } from '../../lib/auditoria.js';
import { adicionarMeses } from '../../lib/datas.js';
import { CODIGOS_ERRO, HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import type { UsuarioAutenticado } from '../../middlewares/autenticar.js';
import { obterPerfil } from '../auth/auth.service.js';
import {
  emailAssinaturaCancelada,
  emailAssinaturaConfirmada,
} from './assinatura.email.js';
import type { AssinarDto, CancelarDto } from './assinatura.schema.js';
import { moverParaCasaNova } from './casa-nova.js';
import { cobrarSimulado } from './gateway-simulado.js';
import { obterMetodo } from './pagamento.service.js';
import {
  type PlanoInfo,
  obterCotaDaCasa,
  obterPlanoVigente,
  paraPlanoInfo,
  verificarSeCabeNoPlano,
} from './plano.service.js';

/** MODEL · regras de planos e assinatura (UC019, UC028 a UC031, RF12 a RF16, RF38; ADR 0002 D3 a D6). */

const VIGENTES = ['ATIVA', 'CANCELADA'] as const;

export interface AssinaturaAtualResposta {
  id: number;
  status: 'ATIVA' | 'CANCELADA';
  plano: PlanoInfo;
  dataInicio: string;
  dataRenovacao: string;
  dataCancelamento: string | null;
  renovaAutomaticamente: boolean;
  podeReativar: boolean;
}

interface LinhaAssinatura {
  id: number;
  status: string;
  dataInicio: Date;
  dataRenovacao: Date;
  dataCancelamento: Date | null;
}

export function paraAssinaturaAtual(a: LinhaAssinatura, plano: PlanoInfo, agora = new Date()): AssinaturaAtualResposta {
  const status = a.status as 'ATIVA' | 'CANCELADA';
  return {
    id: a.id,
    status,
    plano,
    dataInicio: a.dataInicio.toISOString(),
    dataRenovacao: a.dataRenovacao.toISOString(),
    dataCancelamento: a.dataCancelamento ? a.dataCancelamento.toISOString() : null,
    renovaAutomaticamente: status === 'ATIVA',
    podeReativar: status === 'CANCELADA' && a.dataRenovacao.getTime() > agora.getTime(),
  };
}

/** Trava a linha (`SELECT ... FOR UPDATE`) para que pedidos simultâneos não gerem cobrança dupla (ADR 0002 D5). */
async function travar(tx: Prisma.TransactionClient, tabela: 'casa' | 'usuario', id: number): Promise<void> {
  if (tabela === 'casa') await tx.$queryRaw`SELECT id FROM casa WHERE id = ${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM usuario WHERE id = ${id} FOR UPDATE`;
}

const estadoInvalido = (mensagem = 'Esta ação não está disponível agora') =>
  new HttpError(409, CODIGOS_ERRO.ESTADO_INVALIDO, mensagem);

/** UC019 / RF12 / RF14: os três planos e o plano efetivo da Casa do usuário. */
export async function listarPlanos(casaId: number) {
  const [planos, vigente] = await Promise.all([
    prisma.plano.findMany({ orderBy: { preco: 'asc' } }),
    obterPlanoVigente(casaId),
  ]);
  return {
    planos: planos.map(paraPlanoInfo),
    planoAtual: vigente.plano.nome,
    assinatura: vigente.assinatura
      ? { status: vigente.assinatura.status, dataRenovacao: vigente.assinatura.dataRenovacao.toISOString() }
      : null,
  };
}

/** Tela 15 / UC031: assinatura vigente (ou `null` no Individual), uso da cota e método de pagamento do usuário. */
export async function obterAssinaturaAtual(usuario: UsuarioAutenticado) {
  const agora = new Date();
  const [cota, metodoPagamento] = await Promise.all([
    obterCotaDaCasa(usuario.casaId, prisma, agora),
    obterMetodo(usuario.id),
  ]);
  return {
    assinatura: cota.assinatura ? paraAssinaturaAtual(cota.assinatura, cota.plano, agora) : null,
    planoAtual: cota.plano,
    uso: { membros: cota.membros, armazenamento: cota.armazenamento },
    metodoPagamento,
  };
}

/**
 * UC028 / RF13 / RF38: assina ou troca de plano com pagamento simulado.
 * ADMIN assina para a própria Casa; EDITOR e LEITOR saem da Casa e viram ADMIN de uma Casa nova.
 * Ordem das validações: aviso, método presente, mesmo plano, encaixe, pagamento. Tudo em uma transação.
 * O estado PENDENTE é interno e transitório: como a cobrança simulada é síncrona e a transação é única,
 * a assinatura nasce direto como ATIVA (ou nada é gravado).
 */
export async function assinar(usuario: UsuarioAutenticado, dto: AssinarDto) {
  const comoMembro = usuario.papel !== 'ADMIN';
  if (comoMembro && dto.confirmaSaidaDaCasa !== true) {
    throw new HttpError(422, CODIGOS_ERRO.AVISO_NAO_CONFIRMADO, 'Confirme que você vai sair da Casa atual');
  }
  const agora = new Date();

  const resultado = await prisma.$transaction(async (tx) => {
    if (comoMembro) await travar(tx, 'usuario', usuario.id);
    else await travar(tx, 'casa', usuario.casaId);

    // Reconfere depois da trava: um pedido simultâneo pode já ter movido o usuário ou mudado o papel.
    const membro = await tx.membro.findUnique({ where: { usuarioId: usuario.id }, include: { usuario: true } });
    if (!membro || membro.casaId !== usuario.casaId || membro.papel !== usuario.papel) throw estadoInvalido();

    const metodo = await tx.metodoPagamento.findUnique({ where: { usuarioId: usuario.id } });
    if (!metodo) {
      throw new HttpError(422, CODIGOS_ERRO.METODO_PAGAMENTO_AUSENTE, 'Cadastre um método de pagamento para continuar');
    }

    const anterior = comoMembro
      ? null
      : await tx.assinatura.findFirst({
          where: { casaId: usuario.casaId, status: { in: [...VIGENTES] } },
          include: { plano: true },
        });
    if (!comoMembro) {
      const vigente = await obterPlanoVigente(usuario.casaId, tx, agora);
      if (vigente.assinatura && vigente.plano.nome === dto.plano) {
        throw estadoInvalido('Esta já é a sua assinatura. Para religar a renovação, reative a assinatura');
      }
    }

    // A Casa nova de quem assina como membro tem 1 membro e 0 bytes: sempre cabe.
    const encaixe = await verificarSeCabeNoPlano(
      usuario.casaId,
      dto.plano,
      tx,
      comoMembro ? { membros: 1, usadoBytes: 0 } : undefined,
    );
    if (!encaixe.cabe) {
      throw new HttpError(422, CODIGOS_ERRO.PLANO_NAO_COMPORTA, 'A Casa não cabe no plano escolhido', {
        plano: dto.plano,
        violacoes: encaixe.violacoes,
      });
    }

    const cobranca = cobrarSimulado(metodo.ultimos4);
    if (!cobranca.aprovado) return { recusado: true as const };

    let casaId = usuario.casaId;
    if (comoMembro) {
      const casaNova = await moverParaCasaNova(tx, membro.usuario, usuario.casaId);
      casaId = casaNova.id;
      await registrarAuditoria(
        { usuarioId: usuario.id, casaId: usuario.casaId, acao: ACOES_AUDITORIA.MEMBRO_SAIU_DA_CASA, entidade: 'Usuario', entidadeId: usuario.id, detalhes: { casaNovaId: casaNova.id } },
        tx,
      );
      await registrarAuditoria(
        { usuarioId: usuario.id, casaId, acao: ACOES_AUDITORIA.CASA_CRIADA, entidade: 'Casa', entidadeId: casaNova.id, detalhes: { origem: 'ASSINATURA_COMO_MEMBRO' } },
        tx,
      );
    }

    let troca: { id: number; de: string } | null = null;
    if (anterior) {
      const venceuCancelada = anterior.status === 'CANCELADA' && anterior.dataRenovacao.getTime() <= agora.getTime();
      const motivo = venceuCancelada ? 'CANCELAMENTO' : 'TROCA';
      await tx.assinatura.update({
        where: { id: anterior.id },
        data: { status: 'EXPIRADA', motivoEncerramento: motivo, encerradaEm: agora },
      });
      await registrarAuditoria(
        { usuarioId: usuario.id, casaId, acao: ACOES_AUDITORIA.ASSINATURA_EXPIRADA, entidade: 'Assinatura', entidadeId: anterior.id, detalhes: { motivo, membrosDesvinculados: 0 } },
        tx,
      );
      if (motivo === 'TROCA') troca = { id: anterior.id, de: anterior.plano.nome };
    }

    const plano = await tx.plano.findUniqueOrThrow({ where: { nome: dto.plano } });
    const criada = await tx.assinatura.create({
      data: {
        casaId,
        planoId: plano.id,
        titularId: usuario.id,
        status: 'ATIVA',
        dataInicio: agora,
        dataRenovacao: adicionarMeses(agora, 1),
        refPagamento: cobranca.referencia,
      },
    });
    await registrarAuditoria(
      {
        usuarioId: usuario.id,
        casaId,
        acao: ACOES_AUDITORIA.ASSINATURA_CRIADA,
        entidade: 'Assinatura',
        entidadeId: criada.id,
        detalhes: { plano: dto.plano, comoMembro, ...(anterior ? { assinaturaAnteriorId: anterior.id } : {}) },
      },
      tx,
    );
    if (troca) {
      await registrarAuditoria(
        { usuarioId: usuario.id, casaId, acao: ACOES_AUDITORIA.PLANO_ALTERADO, entidade: 'Assinatura', entidadeId: criada.id, detalhes: { de: troca.de, para: dto.plano } },
        tx,
      );
    }
    return { recusado: false as const, criada, plano: paraPlanoInfo(plano), titular: membro.usuario };
  });

  if (resultado.recusado) {
    // Fora da transação (que não gravou nada): a recusa fica registrada mesmo assim.
    await registrarAuditoria({
      usuarioId: usuario.id,
      casaId: usuario.casaId,
      acao: ACOES_AUDITORIA.PAGAMENTO_RECUSADO,
      entidade: 'Casa',
      entidadeId: usuario.casaId,
      detalhes: { plano: dto.plano },
    });
    throw new HttpError(402, CODIGOS_ERRO.PAGAMENTO_RECUSADO, 'Pagamento recusado');
  }

  const { criada, plano, titular } = resultado;
  await emailAssinaturaConfirmada(titular.email, titular.nome, plano.nome, plano.preco, criada.dataRenovacao);
  return { assinatura: paraAssinaturaAtual(criada, plano, agora), perfil: await obterPerfil(usuario.id) };
}

/** UC031 / RF16 / RNF12: cancela a renovação mantendo os benefícios até `dataRenovacao`. */
export async function cancelar(usuario: UsuarioAutenticado, dto: CancelarDto) {
  const agora = new Date();
  const { atual, plano, titular } = await prisma.$transaction(async (tx) => {
    const a = await tx.assinatura.findFirst({
      where: { casaId: usuario.casaId, status: { in: [...VIGENTES] } },
      include: { plano: true },
    });
    if (!a) throw estadoInvalido();
    // Condicional: ATIVA e ainda não vencida (pedido duplicado ou concorrente com o job cai no 409).
    const r = await tx.assinatura.updateMany({
      where: { id: a.id, status: 'ATIVA', dataRenovacao: { gt: agora } },
      data: { status: 'CANCELADA', dataCancelamento: agora },
    });
    if (r.count !== 1) throw estadoInvalido();
    await registrarAuditoria(
      {
        usuarioId: usuario.id,
        casaId: usuario.casaId,
        acao: ACOES_AUDITORIA.ASSINATURA_CANCELADA,
        entidade: 'Assinatura',
        entidadeId: a.id,
        detalhes: { dataRenovacao: a.dataRenovacao.toISOString(), ...(dto.motivo ? { motivo: dto.motivo } : {}) },
      },
      tx,
    );
    return {
      atual: { ...a, status: 'CANCELADA', dataCancelamento: agora },
      plano: paraPlanoInfo(a.plano),
      titular: await tx.usuario.findUniqueOrThrow({ where: { id: usuario.id } }),
    };
  });
  await emailAssinaturaCancelada(titular.email, titular.nome, plano.nome, atual.dataRenovacao);
  return { assinatura: paraAssinaturaAtual(atual, plano, agora) };
}

/** UC031 / RF16: religa a renovação de uma assinatura CANCELADA ainda dentro do período pago. */
export async function reativar(usuario: UsuarioAutenticado) {
  const agora = new Date();
  return prisma.$transaction(async (tx) => {
    const a = await tx.assinatura.findFirst({
      where: { casaId: usuario.casaId, status: { in: [...VIGENTES] } },
      include: { plano: true },
    });
    if (!a) throw estadoInvalido();
    const r = await tx.assinatura.updateMany({
      where: { id: a.id, status: 'CANCELADA', dataRenovacao: { gt: agora } },
      data: { status: 'ATIVA', dataCancelamento: null },
    });
    if (r.count !== 1) throw estadoInvalido();
    await registrarAuditoria(
      {
        usuarioId: usuario.id,
        casaId: usuario.casaId,
        acao: ACOES_AUDITORIA.ASSINATURA_REATIVADA,
        entidade: 'Assinatura',
        entidadeId: a.id,
        detalhes: { dataRenovacao: a.dataRenovacao.toISOString() },
      },
      tx,
    );
    return { assinatura: paraAssinaturaAtual({ ...a, status: 'ATIVA', dataCancelamento: null }, paraPlanoInfo(a.plano), agora) };
  });
}
