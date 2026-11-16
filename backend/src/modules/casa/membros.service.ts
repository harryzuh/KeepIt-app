import { createHmac } from 'node:crypto';
import type { Papel, Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { ACOES_AUDITORIA, registrarAuditoria } from '../../lib/auditoria.js';
import { CODIGOS_ERRO, HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import type { UsuarioAutenticado } from '../../middlewares/autenticar.js';
import { obterPerfil } from '../auth/auth.service.js';
import { moverParaCasaNova } from '../assinatura/casa-nova.js';
import { exigirVagaParaMembro, obterCotaDaCasa } from '../assinatura/plano.service.js';
import { emailAdminExcluiuConta, emailMembroAdicionado, emailMembroRemovido } from './casa.email.js';
import { exigirAdminAtual, travarCasa } from './casa.service.js';
import type { AdicionarMembroDto, AlterarPapelDto } from './casa.schema.js';

/**
 * MODEL · Membros da Casa (M2: UC018, UC033 a UC037; RF25 a RF28; RNF13). Contrato em docs/api/m2-casa.md.
 * Invariantes (ADR 0002): todo usuário está em uma Casa; um único ADMIN por Casa; a Casa nunca fica sem ADMIN;
 * quem sai de uma Casa deixa os produtos dele nela, sem autor. Toda mudança é uma transação com auditoria (RNF05).
 * O id da Casa vem sempre do token (`admin.casaId`); recurso de outra Casa é 404, nunca 403.
 */

type Tx = Prisma.TransactionClient;

export interface MembroDaCasa {
  usuarioId: number;
  nome: string;
  /** Minimização (LGPD): só o ADMIN vê o e-mail dos membros; para EDITOR e LEITOR o campo é omitido. */
  email?: string;
  papel: Papel;
  entrouEm: string;
}

const naoEncontrado = () => new HttpError(404, CODIGOS_ERRO.NAO_ENCONTRADO, 'Membro não encontrado');
const estadoInvalido = () => new HttpError(409, CODIGOS_ERRO.ESTADO_INVALIDO, 'Esta ação não está disponível');
const naoTransferivel = () =>
  new HttpError(409, CODIGOS_ERRO.MEMBRO_NAO_TRANSFERIVEL, 'Esta pessoa não pode ser adicionada agora');

function paraMembroDaCasa(m: {
  papel: Papel;
  entrouEm: Date;
  usuario: { id: number; nome: string; email: string };
}, incluirEmail = true): MembroDaCasa {
  return {
    usuarioId: m.usuario.id,
    nome: m.usuario.nome,
    ...(incluirEmail && { email: m.usuario.email }),
    papel: m.papel,
    entrouEm: m.entrouEm.toISOString(),
  };
}

async function travarUsuario(tx: Tx, usuarioId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM usuario WHERE id = ${usuarioId} FOR UPDATE`;
}

/** UC018 / RF25: membros, plano e limite da Casa (tela 11). ADMIN primeiro, depois por entrada e id. */
export async function listarMembros(casaId: number, papelDoSolicitante: Papel = 'LEITOR') {
  const [casa, cota, membros] = await Promise.all([
    prisma.casa.findUniqueOrThrow({ where: { id: casaId } }),
    obterCotaDaCasa(casaId),
    prisma.membro.findMany({ where: { casaId }, include: { usuario: true } }),
  ]);
  membros.sort((a, b) => {
    if ((a.papel === 'ADMIN') !== (b.papel === 'ADMIN')) return a.papel === 'ADMIN' ? -1 : 1;
    return a.entrouEm.getTime() - b.entrouEm.getTime() || a.usuarioId - b.usuarioId;
  });
  return {
    casa: { id: casa.id, nome: casa.nome },
    plano: cota.plano,
    assinatura: cota.assinatura
      ? { status: cota.assinatura.status, dataRenovacao: cota.assinatura.dataRenovacao.toISOString() }
      : null,
    limiteMembros: cota.membros.limite,
    membrosEmUso: cota.membros.emUso,
    membros: membros.map((m) => paraMembroDaCasa(m, papelDoSolicitante === 'ADMIN')),
  };
}

/**
 * UC033 / UC034 / RF26 / RNF13: o ADMIN adiciona, na hora, uma conta já cadastrada. Se a pessoa estava em outra Casa,
 * sai dela (transferência) na mesma transação. Ordem: conta existente, já é da Casa, transferível, vaga no plano.
 * Não transferíveis (ADR 0002 D7): ADMIN de Casa com outros membros, titular de assinatura vigente e ADMIN solo
 * cuja Casa tem produtos. A vaga e a inclusão ocorrem com a Casa travada (duas adições não passam do limite).
 */
export async function adicionarMembro(admin: UsuarioAutenticado, dto: AdicionarMembroDto) {
  try {
    return await adicionarMembroSemAuditoriaDeNegacao(admin, dto);
  } catch (err) {
    // Tentativa negada (404/409): auditada fora da transação revertida, sem o e-mail em claro (só um HMAC curto).
    if (err instanceof HttpError && CODIGOS_AUDITADOS_NA_NEGACAO.has(err.codigo)) {
      await registrarAuditoria({
        usuarioId: admin.id,
        casaId: admin.casaId,
        acao: ACOES_AUDITORIA.MEMBRO_ADICAO_NEGADA,
        entidade: 'Casa',
        entidadeId: admin.casaId,
        detalhes: { codigo: err.codigo, emailHmac: hmacDoEmail(dto.email) },
      }).catch(() => undefined); // falha de log não troca a resposta
    }
    throw err;
  }
}

const CODIGOS_AUDITADOS_NA_NEGACAO: ReadonlySet<string> = new Set([
  CODIGOS_ERRO.USUARIO_NAO_ENCONTRADO,
  CODIGOS_ERRO.MEMBRO_JA_NA_CASA,
  CODIGOS_ERRO.MEMBRO_NAO_TRANSFERIVEL,
  CODIGOS_ERRO.LIMITE_MEMBROS,
]);

/** Identificador estável do e-mail para correlacionar tentativas sem gravar o endereço. */
function hmacDoEmail(email: string): string {
  return createHmac('sha256', env.CODIGO_SECRET ?? env.JWT_SECRET).update(email).digest('hex').slice(0, 16);
}

async function adicionarMembroSemAuditoriaDeNegacao(admin: UsuarioAutenticado, dto: AdicionarMembroDto) {
  // A vaga é conferida ANTES de consultar o e-mail: ADMIN de Casa cheia (ex.: Individual, limite 1) sempre recebe
  // LIMITE_MEMBROS e nunca distingue "sem conta" de "conta existente". A checagem é refeita dentro da transação.
  await exigirVagaParaMembro(admin.casaId);
  const alvo = await prisma.usuario.findUnique({ where: { email: dto.email }, include: { membro: true } });
  // Mesma resposta para e-mail sem conta e para conta com exclusão solicitada (não revela o estado da conta).
  if (!alvo || alvo.exclusaoSolicitadaEm || !alvo.membro) throw erroContaInexistente();

  const resultado = await prisma.$transaction(async (tx) => {
    const origemLida = alvo.membro!.casaId;
    // Trava as duas Casas em ordem de id (evita impasse quando dois ADMINs se adicionam ao mesmo tempo).
    for (const id of [...new Set([admin.casaId, origemLida])].sort((a, b) => a - b)) await travarCasa(tx, id);
    await travarUsuario(tx, alvo.id);
    await exigirAdminAtual(tx, admin);

    // Reconfere o estado da pessoa depois das travas.
    const usuario = await tx.usuario.findUnique({ where: { id: alvo.id }, include: { membro: true } });
    if (!usuario || usuario.exclusaoSolicitadaEm || !usuario.membro) throw erroContaInexistente();
    const atual = usuario.membro;
    if (atual.casaId === admin.casaId) {
      throw new HttpError(409, CODIGOS_ERRO.MEMBRO_JA_NA_CASA, 'Esta pessoa já faz parte da sua Casa');
    }
    if (atual.casaId !== origemLida) throw estadoInvalido(); // mudou de Casa entre a leitura e a trava: tente de novo

    const origemId = atual.casaId;
    let casaVazia = false;
    if (atual.papel === 'ADMIN') {
      const [membros, vigentes, produtos] = await Promise.all([
        tx.membro.count({ where: { casaId: origemId } }),
        tx.assinatura.count({ where: { casaId: origemId, status: { in: ['ATIVA', 'CANCELADA'] } } }),
        tx.produto.count({ where: { casaId: origemId } }),
      ]);
      if (membros > 1 || vigentes > 0 || produtos > 0) throw naoTransferivel();
      casaVazia = true;
    }

    await exigirVagaParaMembro(admin.casaId, tx);

    await tx.membro.delete({ where: { usuarioId: alvo.id } });
    await tx.produto.updateMany({ where: { casaId: origemId, adicionadoPorId: alvo.id }, data: { adicionadoPorId: null } });
    const novo = await tx.membro.create({
      data: { usuarioId: alvo.id, casaId: admin.casaId, papel: dto.papel },
      include: { usuario: true },
    });
    if (casaVazia) {
      // A Casa só tinha esta pessoa, sem assinatura vigente nem produtos: nada se perde (A3).
      await registrarAuditoria(
        { usuarioId: admin.id, casaId: origemId, acao: ACOES_AUDITORIA.CASA_REMOVIDA, entidade: 'Casa', entidadeId: origemId, detalhes: { motivo: 'ADMIN_TRANSFERIDO' } },
        tx,
      );
      await tx.casa.delete({ where: { id: origemId } });
    }
    await registrarAuditoria(
      {
        usuarioId: admin.id,
        casaId: admin.casaId,
        acao: ACOES_AUDITORIA.MEMBRO_ADICIONADO,
        entidade: 'Usuario',
        entidadeId: alvo.id,
        detalhes: { papel: dto.papel, casaAnteriorId: origemId },
      },
      tx,
    );
    const [cota, casa, quemAdicionou] = await Promise.all([
      obterCotaDaCasa(admin.casaId, tx),
      tx.casa.findUniqueOrThrow({ where: { id: admin.casaId } }),
      tx.usuario.findUniqueOrThrow({ where: { id: admin.id } }),
    ]);
    return { novo, cota, casa, adminNome: quemAdicionou.nome };
  });

  const { novo, cota, casa, adminNome } = resultado;
  await emailMembroAdicionado(novo.usuario.email, novo.usuario.nome, casa.nome, adminNome, novo.papel);
  return {
    membro: paraMembroDaCasa(novo),
    membrosEmUso: cota.membros.emUso,
    limiteMembros: cota.membros.limite,
  };
}

function erroContaInexistente() {
  return new HttpError(404, CODIGOS_ERRO.USUARIO_NAO_ENCONTRADO, 'A pessoa precisa ter uma conta KeepIT');
}

/** UC034 / UC036 / RF28: EDITOR ↔ LEITOR. O ADMIN não altera o próprio papel. Papel igual: 200 sem log. */
export async function alterarPapel(admin: UsuarioAutenticado, usuarioId: number, dto: AlterarPapelDto) {
  return prisma.$transaction(async (tx) => {
    await travarCasa(tx, admin.casaId);
    await exigirAdminAtual(tx, admin);
    const membro = await tx.membro.findFirst({ where: { usuarioId, casaId: admin.casaId }, include: { usuario: true } });
    if (!membro) throw naoEncontrado();
    if (membro.papel === 'ADMIN') throw estadoInvalido();
    if (membro.papel === dto.papel) return { membro: paraMembroDaCasa(membro) };
    const atualizado = await tx.membro.update({
      where: { id: membro.id },
      data: { papel: dto.papel },
      include: { usuario: true },
    });
    await registrarAuditoria(
      {
        usuarioId: admin.id,
        casaId: admin.casaId,
        acao: ACOES_AUDITORIA.MEMBRO_PAPEL_ALTERADO,
        entidade: 'Usuario',
        entidadeId: usuarioId,
        detalhes: { de: membro.papel, para: dto.papel },
      },
      tx,
    );
    return { membro: paraMembroDaCasa(atualizado) };
  });
}

/**
 * UC035 / RF27 / RNF12: remove um membro (a confirmação é do front). Ele ganha uma Casa Individual própria, da qual é
 * ADMIN; os produtos dele ficam na Casa sem autor. A assinatura da Casa não muda. O ADMIN não se remove (409).
 */
export async function removerMembro(admin: UsuarioAutenticado, usuarioId: number): Promise<void> {
  const aviso = await prisma.$transaction(async (tx) => {
    await travarCasa(tx, admin.casaId);
    await exigirAdminAtual(tx, admin);
    // Só trava o usuário depois de confirmar que ele é membro desta Casa (id alheio não trava linha de outra Casa).
    const previo = await tx.membro.findFirst({ where: { usuarioId, casaId: admin.casaId }, select: { id: true } });
    if (!previo) throw naoEncontrado();
    await travarUsuario(tx, usuarioId); // um "assinar como membro" simultâneo do alvo também trava o usuário
    const membro = await tx.membro.findFirst({ where: { usuarioId, casaId: admin.casaId }, include: { usuario: true } });
    if (!membro) throw naoEncontrado();
    if (membro.papel === 'ADMIN') throw estadoInvalido();
    const casaAntiga = await tx.casa.findUniqueOrThrow({ where: { id: admin.casaId } });
    const casaNova = await moverParaCasaNova(tx, membro.usuario, admin.casaId);
    await registrarAuditoria(
      {
        usuarioId: admin.id,
        casaId: admin.casaId,
        acao: ACOES_AUDITORIA.MEMBRO_REMOVIDO,
        entidade: 'Usuario',
        entidadeId: usuarioId,
        detalhes: { motivo: 'REMOVIDO_PELO_ADMIN', casaNovaId: casaNova.id },
      },
      tx,
    );
    await registrarAuditoria(
      { usuarioId, casaId: casaNova.id, acao: ACOES_AUDITORIA.CASA_CRIADA, entidade: 'Casa', entidadeId: casaNova.id, detalhes: { origem: 'MEMBRO_REMOVIDO' } },
      tx,
    );
    return { email: membro.usuario.email, nome: membro.usuario.nome, casaAntiga: casaAntiga.nome, casaNova: casaNova.nome };
  });
  await emailMembroRemovido(aviso.email, aviso.nome, aviso.casaAntiga, aviso.casaNova);
}

/** Pessoa a avisar por e-mail depois que a exclusão de conta for confirmada. */
export interface AvisoDeExclusao {
  email: string;
  nome: string;
  casa: string;
  promovido: boolean;
  casaNova?: string;
}

/**
 * Gancho da exclusão de conta (UC013, fecha ACH-08; ADR 0002 D3 e D8). Roda na transação do bloqueio da conta.
 * - EDITOR/LEITOR: o vínculo sai na hora (libera a vaga); produtos ficam sem autor.
 * - ADMIN solo: a assinatura vigente expira (TITULAR_EXCLUIDO); a rotina apaga a conta e a Casa depois (A3).
 * - ADMIN com outros membros: a assinatura expira; o membro mais antigo (preferindo EDITOR) é promovido a ADMIN e
 *   mantém a Casa e os produtos; os demais recebem Casa própria Individual. A Casa nunca fica sem ADMIN.
 * Devolve os avisos de e-mail, que quem chama envia depois do commit.
 */
export async function tratarExclusaoDeConta(tx: Tx, usuarioId: number): Promise<AvisoDeExclusao[]> {
  const previo = await tx.membro.findUnique({ where: { usuarioId } });
  if (!previo) return [];
  await travarCasa(tx, previo.casaId);
  const membro = await tx.membro.findUnique({ where: { usuarioId } });
  if (!membro || membro.casaId !== previo.casaId) throw estadoInvalido(); // mudou de Casa durante o pedido
  const casaId = membro.casaId;

  if (membro.papel !== 'ADMIN') {
    await tx.membro.delete({ where: { id: membro.id } });
    await tx.produto.updateMany({ where: { casaId, adicionadoPorId: usuarioId }, data: { adicionadoPorId: null } });
    await registrarAuditoria(
      { usuarioId, casaId, acao: ACOES_AUDITORIA.MEMBRO_REMOVIDO, entidade: 'Usuario', entidadeId: usuarioId, detalhes: { motivo: 'CONTA_EXCLUIDA' } },
      tx,
    );
    return [];
  }

  // Trava os outros membros em ordem de id (um "assinar como membro" simultâneo deles trava o usuário).
  const ids = (await tx.membro.findMany({ where: { casaId, usuarioId: { not: usuarioId } }, select: { usuarioId: true } }))
    .map((m) => m.usuarioId)
    .sort((a, b) => a - b);
  for (const id of ids) await travarUsuario(tx, id);
  const outros = await tx.membro.findMany({
    where: { casaId, usuarioId: { not: usuarioId } },
    include: { usuario: true },
    orderBy: [{ entrouEm: 'asc' }, { usuarioId: 'asc' }],
  });

  const agora = new Date();
  const vigente = await tx.assinatura.findFirst({ where: { casaId, status: { in: ['ATIVA', 'CANCELADA'] } } });
  if (vigente) {
    await tx.assinatura.update({
      where: { id: vigente.id },
      data: { status: 'EXPIRADA', motivoEncerramento: 'TITULAR_EXCLUIDO', encerradaEm: agora },
    });
    await registrarAuditoria(
      { usuarioId, casaId, acao: ACOES_AUDITORIA.ASSINATURA_EXPIRADA, entidade: 'Assinatura', entidadeId: vigente.id, detalhes: { motivo: 'TITULAR_EXCLUIDO', membrosDesvinculados: Math.max(outros.length - 1, 0) } },
      tx,
    );
  }
  // Herdeiro: o membro mais antigo, preferindo EDITOR (a lista já vem por antiguidade), que não tenha pedido a
  // própria exclusão (senão a Casa ficaria com um ADMIN que a rotina vai apagar).
  const candidatos = outros.filter((m) => m.usuario.exclusaoSolicitadaEm === null);
  const herdeiro = candidatos.find((m) => m.papel === 'EDITOR') ?? candidatos[0];
  if (!herdeiro) return []; // sem herdeiro (ADMIN solo ou todos já excluindo): trata como ADMIN solo; a rotina apaga depois
  const casa = await tx.casa.findUniqueOrThrow({ where: { id: casaId } });
  await tx.produto.updateMany({ where: { casaId, adicionadoPorId: usuarioId }, data: { adicionadoPorId: null } });
  // O ADMIN sai antes da promoção: o índice único parcial permite um só ADMIN por Casa.
  await tx.membro.delete({ where: { id: membro.id } });
  await tx.membro.update({ where: { id: herdeiro.id }, data: { papel: 'ADMIN' } });
  await registrarAuditoria(
    { usuarioId, casaId, acao: ACOES_AUDITORIA.MEMBRO_REMOVIDO, entidade: 'Usuario', entidadeId: usuarioId, detalhes: { motivo: 'CONTA_EXCLUIDA' } },
    tx,
  );
  await registrarAuditoria(
    { usuarioId, casaId, acao: ACOES_AUDITORIA.MEMBRO_PROMOVIDO_ADMIN, entidade: 'Usuario', entidadeId: herdeiro.usuarioId, detalhes: { casaId } },
    tx,
  );
  const avisos: AvisoDeExclusao[] = [
    { email: herdeiro.usuario.email, nome: herdeiro.usuario.nome, casa: casa.nome, promovido: true },
  ];
  for (const m of outros) {
    if (m.id === herdeiro.id) continue;
    const casaNova = await moverParaCasaNova(tx, m.usuario, casaId);
    await registrarAuditoria(
      { usuarioId, casaId, acao: ACOES_AUDITORIA.MEMBRO_REMOVIDO, entidade: 'Usuario', entidadeId: m.usuarioId, detalhes: { motivo: 'CONTA_EXCLUIDA', casaNovaId: casaNova.id } },
      tx,
    );
    await registrarAuditoria(
      { usuarioId: m.usuarioId, casaId: casaNova.id, acao: ACOES_AUDITORIA.CASA_CRIADA, entidade: 'Casa', entidadeId: casaNova.id, detalhes: { origem: 'ADMIN_EXCLUIU_CONTA' } },
      tx,
    );
    avisos.push({ email: m.usuario.email, nome: m.usuario.nome, casa: casa.nome, promovido: false, casaNova: casaNova.nome });
  }
  return avisos;
}

/** Envia os avisos da exclusão depois do commit (falha de e-mail não desfaz nada). */
export async function enviarAvisosDeExclusao(avisos: AvisoDeExclusao[]): Promise<void> {
  for (const a of avisos) await emailAdminExcluiuConta(a.email, a.nome, a.casa, a.promovido, a.casaNova);
}

/**
 * POST /casa/sair: EDITOR ou LEITOR deixa a Casa por conta própria e ganha uma Casa Individual dele (ADMIN).
 * Fecha o risco de movimentação sem consentimento (docs/api/m2-casa.md, seção "Riscos aceitos"). O ADMIN não sai
 * (409 ESTADO_INVALIDO): a Casa nunca fica sem ADMIN. Os produtos dele ficam na Casa sem autor, como em toda saída.
 */
export async function sairDaCasa(usuario: UsuarioAutenticado) {
  await prisma.$transaction(async (tx) => {
    await travarCasa(tx, usuario.casaId);
    await travarUsuario(tx, usuario.id);
    const membro = await tx.membro.findUnique({ where: { usuarioId: usuario.id }, include: { usuario: true } });
    // Reconfere depois das travas: o papel ou a Casa podem ter mudado desde que o token foi lido.
    if (!membro || membro.casaId !== usuario.casaId || membro.papel === 'ADMIN') throw estadoInvalido();
    const casaNova = await moverParaCasaNova(tx, membro.usuario, usuario.casaId);
    await registrarAuditoria(
      { usuarioId: usuario.id, casaId: usuario.casaId, acao: ACOES_AUDITORIA.MEMBRO_SAIU_DA_CASA, entidade: 'Usuario', entidadeId: usuario.id, detalhes: { motivo: 'SAIU_PELA_PROPRIA_CONTA', casaNovaId: casaNova.id } },
      tx,
    );
    await registrarAuditoria(
      { usuarioId: usuario.id, casaId: casaNova.id, acao: ACOES_AUDITORIA.CASA_CRIADA, entidade: 'Casa', entidadeId: casaNova.id, detalhes: { origem: 'SAIU_DA_CASA' } },
      tx,
    );
  });
  return { perfil: await obterPerfil(usuario.id) };
}
