import { Prisma, type NomePlano, type Papel } from '@prisma/client';
import { ACOES_AUDITORIA, registrarAuditoria } from '../../lib/auditoria.js';
import { conferirCodigo, expiracaoDoCodigo, gerarCodigoNumerico, hashCodigo } from '../../lib/codigo.js';
import { descreverErro } from '../../lib/erro-log.js';
import { CODIGOS_ERRO, HttpError } from '../../lib/http-error.js';
import { assinarToken } from '../../lib/jwt.js';
import { enviarAvisoTrocaDeEmail, enviarEmailCodigo } from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';
import { apagarPrefixo, prefixoRaizDaCasa } from '../../lib/s3.js';
import { conferirSenha, hashSenha } from '../../lib/senha.js';
import { limiteEmBytes, obterArmazenamentoUsadoBytes, obterPlanoVigente } from '../assinatura/plano.service.js';
import { criarCasaIndividual } from '../casa/casa.service.js';
import { enviarAvisosDeExclusao, tratarExclusaoDeConta } from '../casa/membros.service.js';
import type { AlterarSenhaDto, CadastroDto, LoginDto, PedirTrocaEmailDto, RedefinirSenhaDto } from './auth.schema.js';

/** MODEL · regras de negócio do M1 (sem HTTP). */

/**
 * Prazo para apagar os dados após o pedido de exclusão (RNF16, história 8.3.2).
 * 23 h e não 24 h: a rotina roda de hora em hora (GitHub Actions), então no pior caso
 * a conta é apagada perto de 24 h depois do pedido, dentro do prazo legal (decisão do PO, STATUS.md).
 */
export const PRAZO_EXCLUSAO_HORAS = 23;

export interface Perfil {
  id: number;
  nome: string;
  email: string;
  criadoEm: string;
  casa: { id: number; nome: string; totalMembros: number };
  papel: Papel;
  plano: { nome: NomePlano; preco: string; limiteMembros: number; limiteArmazenamentoGb: number };
  /** ADR 0002 (D10): assinatura vigente da Casa (ATIVA ou CANCELADA); `null` no plano Individual. */
  assinatura: { status: 'ATIVA' | 'CANCELADA'; dataRenovacao: string } | null;
  /** M3 (RF39, contrato m3-produtos.md seção 1): uso de armazenamento da Casa para todos os papéis (tela 08). */
  uso: { armazenamento: { usadoBytes: number; limiteBytes: number } };
}

/** Erros de digitação aceitos por código de verificação; no limite ele é invalidado (AppSec F2). */
export const MAX_TENTATIVAS_CODIGO = 5;

/** Limite de espera (horas) antes de alertar sobre exclusões pendentes (prazo legal: 24 h, RNF16). */
export const ALERTA_EXCLUSAO_HORAS = 20;

/**
 * Corte de sessões "para valer já": tokens emitidos ANTES deste instante deixam de valer. O JWT carrega
 * `iatMs` (milissegundos) e o middleware compara com o corte exato, então um token emitido logo depois
 * (novo login, token novo da troca de senha) vale mesmo dentro do mesmo segundo (ADR 0001, A1).
 */
function corteDeSessoes(agora = new Date()): Date {
  return agora;
}

const erroEmailEmUso = () => new HttpError(409, CODIGOS_ERRO.EMAIL_EM_USO, 'E-mail já cadastrado');
const erroCodigoInvalido = () => new HttpError(400, CODIGOS_ERRO.CODIGO_INVALIDO, 'Código inválido ou expirado');

function violacaoDeUnicidade(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Monta o Perfil (login, cadastro, GET/PATCH /me, confirmação de e-mail). Nunca expõe senha/hash/código. */
export async function obterPerfil(usuarioId: number, db: Prisma.TransactionClient = prisma): Promise<Perfil> {
  const usuario = await db.usuario.findUnique({
    where: { id: usuarioId },
    include: { membro: { include: { casa: { include: { _count: { select: { membros: true } } } } } } },
  });
  if (!usuario || usuario.exclusaoSolicitadaEm || !usuario.membro) {
    throw new HttpError(401, CODIGOS_ERRO.SESSAO_EXPIRADA, 'Sessão encerrada');
  }
  const { casa, papel } = usuario.membro;
  // Plano efetivo pelo serviço único (ADR 0002 D1): sem assinatura vigente é o INDIVIDUAL.
  const { plano, assinatura } = await obterPlanoVigente(casa.id, db);
  const usadoBytes = await obterArmazenamentoUsadoBytes(casa.id, db);
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    criadoEm: usuario.criadoEm.toISOString(),
    casa: { id: casa.id, nome: casa.nome, totalMembros: casa._count.membros },
    papel,
    plano: {
      nome: plano.nome,
      preco: plano.preco,
      limiteMembros: plano.limiteMembros,
      limiteArmazenamentoGb: plano.limiteArmazenamentoGb,
    },
    assinatura: assinatura
      ? { status: assinatura.status, dataRenovacao: assinatura.dataRenovacao.toISOString() }
      : null,
    uso: { armazenamento: { usadoBytes, limiteBytes: limiteEmBytes(plano) } },
  };
}

/** UC008 / RF02 / RF32: cria Usuario + Casa + Membro ADMIN em uma única transação (RNF27). */
export async function cadastrar(dto: CadastroDto): Promise<{ token: string; usuario: Perfil }> {
  if (await prisma.usuario.findUnique({ where: { email: dto.email }, select: { id: true } })) {
    throw erroEmailEmUso();
  }
  const senhaHash = await hashSenha(dto.senha);
  try {
    const usuarioId = await prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.create({
        data: {
          nome: dto.nome,
          email: dto.email,
          senhaHash,
          // Relógio da aplicação (e não o now() do banco): ver ADR 0001, A1.
          sessoesValidasDesde: new Date(),
        },
      });
      const casa = await criarCasaIndividual(tx, usuario.id, usuario.nome);
      await registrarAuditoria(
        { usuarioId: usuario.id, casaId: casa.id, acao: ACOES_AUDITORIA.CONTA_CRIADA, entidade: 'Usuario', entidadeId: usuario.id },
        tx,
      );
      return usuario.id;
    });
    return { token: assinarToken(usuarioId), usuario: await obterPerfil(usuarioId) };
  } catch (err) {
    // Corrida entre dois cadastros com o mesmo e-mail: o banco garante a unicidade.
    if (violacaoDeUnicidade(err)) throw erroEmailEmUso();
    throw err;
  }
}

/** UC004 / UC005: mesma resposta para e-mail inexistente, senha errada e conta com exclusão solicitada. */
export async function entrar(dto: LoginDto): Promise<{ token: string; usuario: Perfil }> {
  const usuario = await prisma.usuario.findUnique({ where: { email: dto.email } });
  const hash = usuario && !usuario.exclusaoSolicitadaEm ? usuario.senhaHash : null;
  if (!usuario || !(await conferirSenha(dto.senha, hash))) {
    throw new HttpError(401, CODIGOS_ERRO.CREDENCIAIS_INVALIDAS, 'E-mail ou senha inválidos');
  }
  return { token: assinarToken(usuario.id), usuario: await obterPerfil(usuario.id) };
}

/** Gera, grava (hash) e envia um código; invalida os anteriores pendentes da mesma finalidade. */
async function emitirCodigo(args: {
  usuarioId: number;
  nome: string;
  finalidade: 'RECUPERAR_SENHA' | 'ALTERAR_EMAIL';
  enviarPara: string;
  novoEmail?: string;
}): Promise<{ expiraEm: Date }> {
  const agora = new Date();
  const codigo = gerarCodigoNumerico();
  const expiraEm = expiracaoDoCodigo(agora);
  const criado = await prisma.$transaction(async (tx) => {
    await tx.codigoVerificacao.updateMany({
      where: { usuarioId: args.usuarioId, finalidade: args.finalidade, usadoEm: null },
      data: { usadoEm: agora },
    });
    return tx.codigoVerificacao.create({
      data: {
        usuarioId: args.usuarioId,
        finalidade: args.finalidade,
        codigoHash: hashCodigo(codigo, `${args.usuarioId}:${args.finalidade}`),
        novoEmail: args.novoEmail ?? null,
        expiraEm,
      },
    });
  });
  try {
    await enviarEmailCodigo({ para: args.enviarPara, nome: args.nome, codigo, finalidade: args.finalidade });
  } catch (err) {
    // Sem e-mail entregue o código não serve: descarta para não deixar pedido pendente.
    await prisma.codigoVerificacao.delete({ where: { id: criado.id } }).catch(() => undefined);
    throw err;
  }
  return { expiraEm };
}

/**
 * Busca o código vigente (não usado, não expirado, com tentativas restantes) e confere o hash.
 * Cada conferência gasta uma tentativa ANTES da comparação, de forma atômica no banco: com requisições
 * simultâneas, só `MAX_TENTATIVAS_CODIGO` comparações acontecem por código, de qualquer IP.
 * Esgotadas as tentativas o código deixa de valer e é preciso pedir outro. Devolve o registro ou null.
 */
async function buscarCodigoValido(
  usuarioId: number,
  finalidade: 'RECUPERAR_SENHA' | 'ALTERAR_EMAIL',
  codigo: string,
) {
  const registro = await prisma.codigoVerificacao.findFirst({
    where: {
      usuarioId,
      finalidade,
      usadoEm: null,
      expiraEm: { gt: new Date() },
      tentativas: { lt: MAX_TENTATIVAS_CODIGO },
    },
    orderBy: { id: 'desc' },
  });
  if (!registro) return null;
  const { count } = await prisma.codigoVerificacao.updateMany({
    where: { id: registro.id, usadoEm: null, tentativas: { lt: MAX_TENTATIVAS_CODIGO } },
    data: { tentativas: { increment: 1 } },
  });
  if (count === 0) return null;
  return conferirCodigo(codigo, registro.codigoHash, `${usuarioId}:${finalidade}`) ? registro : null;
}

/** Invalida os códigos pendentes do usuário (troca de senha: um código antigo não pode valer depois). */
async function invalidarCodigosPendentes(tx: Prisma.TransactionClient, usuarioId: number, agora = new Date()) {
  await tx.codigoVerificacao.updateMany({ where: { usuarioId, usadoEm: null }, data: { usadoEm: agora } });
}

/** UC006 / RF17: envia o código de 6 dígitos. 404 se não houver conta (risco de enumeração aceito no UC006). */
export async function recuperarSenha(email: string): Promise<{ expiraEm: string }> {
  const usuario = await prisma.usuario.findUnique({ where: { email } });
  if (!usuario || usuario.exclusaoSolicitadaEm) {
    throw new HttpError(404, CODIGOS_ERRO.CONTA_NAO_ENCONTRADA, 'Conta não encontrada');
  }
  const { expiraEm } = await emitirCodigo({
    usuarioId: usuario.id,
    nome: usuario.nome,
    finalidade: 'RECUPERAR_SENHA',
    enviarPara: usuario.email,
  });
  return { expiraEm: expiraEm.toISOString() };
}

/** UC007 / UC009: troca a senha com o código, consome o código e encerra todas as sessões. */
export async function redefinirSenha(dto: RedefinirSenhaDto): Promise<void> {
  const usuario = await prisma.usuario.findUnique({ where: { email: dto.email } });
  // E-mail sem conta (ou em exclusão) responde igual a código errado: sem enumeração.
  if (!usuario || usuario.exclusaoSolicitadaEm) throw erroCodigoInvalido();
  const registro = await buscarCodigoValido(usuario.id, 'RECUPERAR_SENHA', dto.codigo);
  if (!registro) throw erroCodigoInvalido();

  const senhaHash = await hashSenha(dto.novaSenha);
  await prisma.$transaction(async (tx) => {
    // Uso único: só quem marcar o código como usado primeiro segue (protege contra requisições simultâneas).
    const { count } = await tx.codigoVerificacao.updateMany({
      where: { id: registro.id, usadoEm: null },
      data: { usadoEm: new Date() },
    });
    if (count === 0) throw erroCodigoInvalido();
    await tx.usuario.update({
      where: { id: usuario.id },
      data: { senhaHash, sessoesValidasDesde: corteDeSessoes() },
    });
    await invalidarCodigosPendentes(tx, usuario.id);
    await registrarAuditoria(
      { usuarioId: usuario.id, acao: ACOES_AUDITORIA.SENHA_REDEFINIDA, entidade: 'Usuario', entidadeId: usuario.id },
      tx,
    );
  });
}

/** UC012 / RF21: encerra a sessão (todas as emitidas até agora). */
export async function sair(usuarioId: number, casaId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id: usuarioId }, data: { sessoesValidasDesde: corteDeSessoes() } });
    await registrarAuditoria(
      { usuarioId, casaId, acao: ACOES_AUDITORIA.SESSAO_ENCERRADA, entidade: 'Usuario', entidadeId: usuarioId },
      tx,
    );
  });
}

/** UC015 / RF18: edita o nome (o e-mail tem fluxo próprio com código). */
export async function atualizarNome(usuarioId: number, nome: string): Promise<Perfil> {
  await prisma.usuario.update({ where: { id: usuarioId }, data: { nome } });
  return obterPerfil(usuarioId);
}

/** UC015 / RF19, passo 1: envia o código ao NOVO e-mail; o e-mail atual continua valendo. */
export async function pedirTrocaDeEmail(
  usuarioId: number,
  { email: novoEmail, senhaAtual }: PedirTrocaEmailDto,
): Promise<{ expiraEm: string }> {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  // Reautenticação: um token roubado sozinho não basta para trocar o e-mail (AppSec F3).
  if (!(await conferirSenha(senhaAtual, usuario.senhaHash))) {
    throw new HttpError(401, CODIGOS_ERRO.SENHA_INCORRETA, 'Senha atual incorreta');
  }
  if (novoEmail === usuario.email) {
    throw new HttpError(422, CODIGOS_ERRO.DADOS_INVALIDOS, 'Dados inválidos', [
      { campo: 'email', mensagem: 'O novo e-mail deve ser diferente do atual' },
    ]);
  }
  if (await prisma.usuario.findUnique({ where: { email: novoEmail }, select: { id: true } })) {
    throw erroEmailEmUso();
  }
  const { expiraEm } = await emitirCodigo({
    usuarioId,
    nome: usuario.nome,
    finalidade: 'ALTERAR_EMAIL',
    enviarPara: novoEmail,
    novoEmail,
  });
  // Aviso ao e-mail atual: o dono real da conta fica sabendo do pedido. Falha no aviso não bloqueia a troca.
  await enviarAvisoTrocaDeEmail({ para: usuario.email, novoEmail, etapa: 'pedido' }).catch((err) =>
    console.error('Falha ao avisar o e-mail atual (pedido de troca):', descreverErro(err)),
  );
  return { expiraEm: expiraEm.toISOString() };
}

/**
 * UC015 / RF19, passo 2: confirma o código, efetiva a troca, encerra as demais sessões e devolve
 * o perfil com um token novo (a sessão atual continua; as outras, inclusive a de um token roubado, caem).
 */
export async function confirmarTrocaDeEmail(
  usuarioId: number,
  codigo: string,
): Promise<Perfil & { token: string }> {
  const registro = await buscarCodigoValido(usuarioId, 'ALTERAR_EMAIL', codigo);
  if (!registro?.novoEmail) throw erroCodigoInvalido();
  const novoEmail = registro.novoEmail;
  let emailAntigo = '';
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.codigoVerificacao.updateMany({
        where: { id: registro.id, usadoEm: null },
        data: { usadoEm: new Date() },
      });
      if (count === 0) throw erroCodigoInvalido();
      emailAntigo = (await tx.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { email: true } })).email;
      await tx.usuario.update({
        where: { id: usuarioId },
        data: { email: novoEmail, sessoesValidasDesde: corteDeSessoes() },
      });
      await invalidarCodigosPendentes(tx, usuarioId);
      await registrarAuditoria(
        { usuarioId, acao: ACOES_AUDITORIA.EMAIL_ALTERADO, entidade: 'Usuario', entidadeId: usuarioId },
        tx,
      );
    });
  } catch (err) {
    // Outra conta confirmou o mesmo e-mail antes: a unicidade do banco decide.
    if (violacaoDeUnicidade(err)) throw erroEmailEmUso();
    throw err;
  }
  await enviarAvisoTrocaDeEmail({ para: emailAntigo, novoEmail, etapa: 'confirmado' }).catch((err) =>
    console.error('Falha ao avisar o e-mail antigo (troca efetivada):', descreverErro(err)),
  );
  return { ...(await obterPerfil(usuarioId)), token: assinarToken(usuarioId) };
}

/** UC010 / UC011 / RF31: exige a senha atual, encerra as demais sessões e devolve um token novo. */
export async function alterarSenha(usuarioId: number, dto: AlterarSenhaDto): Promise<{ token: string }> {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  if (!(await conferirSenha(dto.senhaAtual, usuario.senhaHash))) {
    throw new HttpError(401, CODIGOS_ERRO.SENHA_INCORRETA, 'Senha atual incorreta');
  }
  if (dto.novaSenha === dto.senhaAtual) {
    throw new HttpError(422, CODIGOS_ERRO.SENHA_IGUAL_ATUAL, 'A nova senha deve ser diferente da atual');
  }
  const senhaHash = await hashSenha(dto.novaSenha);
  await prisma.$transaction(async (tx) => {
    // Corte exato (ms): o token novo, emitido logo em seguida, vale; os anteriores caem.
    await tx.usuario.update({ where: { id: usuarioId }, data: { senhaHash, sessoesValidasDesde: corteDeSessoes() } });
    await invalidarCodigosPendentes(tx, usuarioId);
    await registrarAuditoria(
      { usuarioId, acao: ACOES_AUDITORIA.SENHA_ALTERADA, entidade: 'Usuario', entidadeId: usuarioId },
      tx,
    );
  });
  return { token: assinarToken(usuarioId) };
}

/**
 * UC013 / UC014 / RF20: bloqueia a conta na hora (exclusaoSolicitadaEm) e encerra as sessões;
 * os dados pessoais saem em até 24 h pela rotina (`apagarContasVencidas`).
 * Ganchos de M2/M5 (ADR 0002 D3 e D8, fecha ACH-08): na mesma transação, a assinatura do titular expira e a Casa
 * nunca fica sem ADMIN (o membro mais antigo herda; os demais ganham Casa própria). Ver `tratarExclusaoDeConta`.
 */
export async function solicitarExclusao(usuarioId: number, casaId: number, senha: string): Promise<void> {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  if (!(await conferirSenha(senha, usuario.senhaHash))) {
    throw new HttpError(401, CODIGOS_ERRO.SENHA_INCORRETA, 'Senha incorreta');
  }
  const agora = new Date();
  const avisos = await prisma.$transaction(async (tx) => {
    const avisos = await tratarExclusaoDeConta(tx, usuarioId);
    await tx.usuario.update({
      where: { id: usuarioId },
      data: { exclusaoSolicitadaEm: agora, sessoesValidasDesde: corteDeSessoes(agora) },
    });
    await registrarAuditoria(
      { usuarioId, casaId, acao: ACOES_AUDITORIA.EXCLUSAO_SOLICITADA, entidade: 'Usuario', entidadeId: usuarioId },
      tx,
    );
    return avisos;
  });
  await enviarAvisosDeExclusao(avisos);
}

/** LGPD (ADR 0003 D6): apaga do S3 tudo da Casa excluída (fotos e envios pendentes). Nunca lança. */
async function apagarArquivosDaCasa(casaId: number): Promise<void> {
  try {
    const { falhas } = await apagarPrefixo(prefixoRaizDaCasa(casaId));
    if (falhas > 0) console.error(`Casa ${casaId} apagada com ${falhas} objeto(s) no S3 pendente(s); a conciliação de órfãos os recolherá`);
  } catch (err) {
    console.error(`Falha ao apagar os arquivos da Casa ${casaId} no S3; a conciliação de órfãos os recolherá:`, descreverErro(err));
  }
}

/**
 * Rotina (história 8.3.2): apaga em definitivo as contas com exclusão solicitada há mais de PRAZO_EXCLUSAO_HORAS (23 h).
 * Cada conta roda em sua própria transação: se uma falhar, as demais seguem e ela é reprocessada
 * na execução seguinte. Idempotente. Devolve quantas contas foram apagadas.
 *
 * - Produtos do usuário ficam na Casa com `adicionadoPorId` nulo e logs perdem só `usuarioId` (SetNull).
 * - A3 (ADR 0001): se a Casa ficar sem membros, ela é apagada (cascata: produtos, tags, fotos, assinaturas).
 *   M3: depois do commit, apaga os arquivos da Casa no S3 (apagarArquivosDaCasa).
 */
export async function apagarContasVencidas(agora = new Date()): Promise<number> {
  const limite = new Date(agora.getTime() - PRAZO_EXCLUSAO_HORAS * 3_600_000);
  const vencidas = await prisma.usuario.findMany({
    where: { exclusaoSolicitadaEm: { lte: limite } },
    select: { id: true, membro: { select: { casaId: true } } },
  });
  let apagadas = 0;
  for (const { id, membro } of vencidas) {
    try {
      let casaApagadaId: number | null = null;
      await prisma.$transaction(async (tx) => {
        const casaId = membro?.casaId ?? null;
        // Registrado antes de apagar; ao apagar o usuário o log perde a referência (usuarioId nulo).
        await registrarAuditoria(
          { usuarioId: id, casaId, acao: ACOES_AUDITORIA.CONTA_APAGADA, entidade: 'Usuario', entidadeId: id },
          tx,
        );
        if (casaId !== null) {
          await tx.membro.delete({ where: { usuarioId: id } });
          if ((await tx.membro.count({ where: { casaId } })) === 0) {
            await tx.casa.delete({ where: { id: casaId } });
            casaApagadaId = casaId;
          }
        }
        await tx.usuario.delete({ where: { id } });
      });
      apagadas++;
      // Só depois do commit (um rollback não pode deixar a Casa sem fotos). Falha do S3 não desfaz a exclusão:
      // o que sobrar é recolhido pela conciliação de órfãos (limparFotosOrfas).
      if (casaApagadaId !== null) await apagarArquivosDaCasa(casaApagadaId);
    } catch (err) {
      console.error(`Falha ao apagar a conta ${id}; será reprocessada na próxima execução:`, descreverErro(err));
    }
  }
  await alertarExclusoesAtrasadas(agora);
  return apagadas;
}

/**
 * RNF16: alerta (log de erro, que o monitoramento deve capturar) quando há pedidos de exclusão pendentes
 * há mais de `ALERTA_EXCLUSAO_HORAS` horas, ou seja, perto de estourar as 24 h. Só registra ids e contagem.
 * (A causa antiga, `titularId` restrito, foi fechada: a assinatura do titular expira no pedido e `titularId` é SetNull.)
 */
export async function alertarExclusoesAtrasadas(agora = new Date()): Promise<number> {
  const limite = new Date(agora.getTime() - ALERTA_EXCLUSAO_HORAS * 3_600_000);
  const atrasadas = await prisma.usuario.findMany({
    where: { exclusaoSolicitadaEm: { lte: limite } },
    select: { id: true },
    take: 50,
  });
  if (atrasadas.length > 0) {
    console.error(
      `ALERTA RNF16: ${atrasadas.length} exclusão(ões) de conta pendente(s) há mais de ${ALERTA_EXCLUSAO_HORAS} h (usuários: ${atrasadas.map((u) => u.id).join(', ')})`,
    );
  }
  return atrasadas.length;
}
