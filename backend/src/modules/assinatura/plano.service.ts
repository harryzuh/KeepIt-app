import type { NomePlano, Plano, Prisma, PrismaClient, StatusAssinatura } from '@prisma/client';
import { CODIGOS_ERRO, HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';

/**
 * MODEL · Serviço de plano vigente e cota da Casa (história 7.0, ADR 0002 D1).
 * Fonte ÚNICA de limites: M2 (limite de membros), M5 (encaixe no plano), M3 (cota de fotos) e M4 (uso) devem
 * usá-lo e nunca ler `Assinatura`/`Plano` por conta própria. Sem HTTP: lança `HttpError` só nas funções `exigir*`.
 */

/** Cliente do Prisma ou da transação: passe `tx` para ler dentro da mesma transação da regra. */
type Db = Prisma.TransactionClient | PrismaClient;

/** GB em base binária (1 GB = 1024³ bytes). Decisão Q11 / ADR 0002. */
export const BYTES_POR_GB = 1024 ** 3;

export interface PlanoInfo {
  id: number;
  nome: NomePlano;
  /** String decimal ("19.90"). */
  preco: string;
  limiteMembros: number;
  limiteArmazenamentoGb: number;
}

export interface AssinaturaVigente {
  id: number;
  status: Extract<StatusAssinatura, 'ATIVA' | 'CANCELADA'>;
  titularId: number | null;
  dataInicio: Date;
  dataRenovacao: Date;
  dataCancelamento: Date | null;
}

export interface PlanoVigente {
  plano: PlanoInfo;
  /** `null` = plano Individual (a Casa não tem assinatura vigente). */
  assinatura: AssinaturaVigente | null;
}

export interface CotaDaCasa extends PlanoVigente {
  membros: { emUso: number; limite: number };
  armazenamento: { usadoBytes: number; limiteBytes: number };
}

export type LimiteExcedido = 'MEMBROS' | 'ARMAZENAMENTO';

export interface ViolacaoDeLimite {
  limite: LimiteExcedido;
  /** Valor atual (membros ou bytes). */
  atual: number;
  /** Máximo permitido pelo plano (membros ou bytes). */
  maximo: number;
}

export interface ResultadoEncaixe {
  cabe: boolean;
  plano: PlanoInfo;
  violacoes: ViolacaoDeLimite[];
}

/** Converte a linha de `Plano` no formato devolvido pela API. */
export function paraPlanoInfo(plano: Plano): PlanoInfo {
  return {
    id: plano.id,
    nome: plano.nome,
    preco: plano.preco.toFixed(2),
    limiteMembros: plano.limiteMembros,
    limiteArmazenamentoGb: plano.limiteArmazenamentoGb,
  };
}

export function limiteEmBytes(plano: Pick<PlanoInfo, 'limiteArmazenamentoGb'>): number {
  return plano.limiteArmazenamentoGb * BYTES_POR_GB;
}

async function planoIndividual(db: Db): Promise<Plano> {
  const plano = await db.plano.findUnique({ where: { nome: 'INDIVIDUAL' } });
  if (!plano) throw new Error('Plano INDIVIDUAL não cadastrado (rode o seed)');
  return plano;
}

/**
 * Plano efetivo da Casa:
 * - ATIVA: o plano da assinatura (mesmo com `dataRenovacao` vencida, até a rotina renovar ou expirar);
 * - CANCELADA com `dataRenovacao` no futuro: o plano da assinatura (benefícios até a renovação, RF16);
 * - CANCELADA já vencida (rotina ainda não rodou): INDIVIDUAL, sem depender do horário do job;
 * - PENDENTE, EXPIRADA ou nenhuma: INDIVIDUAL.
 */
export async function obterPlanoVigente(casaId: number, db: Db = prisma, agora = new Date()): Promise<PlanoVigente> {
  const assinatura = await db.assinatura.findFirst({
    where: { casaId, status: { in: ['ATIVA', 'CANCELADA'] } },
    include: { plano: true },
  });
  const vigente =
    assinatura && (assinatura.status === 'ATIVA' || assinatura.dataRenovacao.getTime() > agora.getTime())
      ? assinatura
      : null;
  if (!vigente) return { plano: paraPlanoInfo(await planoIndividual(db)), assinatura: null };
  return {
    plano: paraPlanoInfo(vigente.plano),
    assinatura: {
      id: vigente.id,
      status: vigente.status as 'ATIVA' | 'CANCELADA',
      titularId: vigente.titularId,
      dataInicio: vigente.dataInicio,
      dataRenovacao: vigente.dataRenovacao,
      dataCancelamento: vigente.dataCancelamento,
    },
  };
}

/** Membros atuais da Casa. */
export async function contarMembros(casaId: number, db: Db = prisma): Promise<number> {
  return db.membro.count({ where: { casaId } });
}

/** Armazenamento usado pela Casa em bytes: soma de `Foto.tamanhoBytes` dos produtos dela (0 até o M3). */
export async function obterArmazenamentoUsadoBytes(casaId: number, db: Db = prisma): Promise<number> {
  const soma = await db.foto.aggregate({ _sum: { tamanhoBytes: true }, where: { produto: { casaId } } });
  return soma._sum.tamanhoBytes ?? 0;
}

/** Plano vigente + uso e limites de membros e de armazenamento (base de GET /me, tela 11 e M3/M4). */
export async function obterCotaDaCasa(casaId: number, db: Db = prisma, agora = new Date()): Promise<CotaDaCasa> {
  const vigente = await obterPlanoVigente(casaId, db, agora);
  const [emUso, usadoBytes] = await Promise.all([contarMembros(casaId, db), obterArmazenamentoUsadoBytes(casaId, db)]);
  return {
    ...vigente,
    membros: { emUso, limite: vigente.plano.limiteMembros },
    armazenamento: { usadoBytes, limiteBytes: limiteEmBytes(vigente.plano) },
  };
}

/** Pura: compara o uso informado com os limites do plano. */
export function avaliarEncaixe(plano: PlanoInfo, membros: number, usadoBytes: number): ResultadoEncaixe {
  const violacoes: ViolacaoDeLimite[] = [];
  if (membros > plano.limiteMembros) {
    violacoes.push({ limite: 'MEMBROS', atual: membros, maximo: plano.limiteMembros });
  }
  if (usadoBytes > limiteEmBytes(plano)) {
    violacoes.push({ limite: 'ARMAZENAMENTO', atual: usadoBytes, maximo: limiteEmBytes(plano) });
  }
  return { cabe: violacoes.length === 0, plano, violacoes };
}

/**
 * "A Casa cabe no plano X?" (UC028/UC029). Por padrão usa o uso atual da Casa; na assinatura como membro
 * (história 7.6) a Casa nova ainda não existe: passe `uso` com `{ membros: 1, usadoBytes: 0 }`.
 * Quem chama monta o `PLANO_NAO_COMPORTA` com `violacoes` em `details`.
 */
export async function verificarSeCabeNoPlano(
  casaId: number,
  nomePlano: NomePlano,
  db: Db = prisma,
  uso?: { membros: number; usadoBytes: number },
): Promise<ResultadoEncaixe> {
  const plano = await db.plano.findUnique({ where: { nome: nomePlano } });
  if (!plano) throw new Error(`Plano ${nomePlano} não cadastrado (rode o seed)`);
  const [membros, usadoBytes] = uso
    ? [uso.membros, uso.usadoBytes]
    : await Promise.all([contarMembros(casaId, db), obterArmazenamentoUsadoBytes(casaId, db)]);
  return avaliarEncaixe(paraPlanoInfo(plano), membros, usadoBytes);
}

/** Base do `LIMITE_MEMBROS` (RNF13): há vaga para mais `quantidade` membros? Chame dentro da transação que insere. */
export async function haVagaParaMembros(casaId: number, quantidade = 1, db: Db = prisma): Promise<boolean> {
  const cota = await obterCotaDaCasa(casaId, db);
  return cota.membros.emUso + quantidade <= cota.membros.limite;
}

/** Lança 409 `LIMITE_MEMBROS` se a Casa já está no limite de membros do plano vigente (RNF13). */
export async function exigirVagaParaMembro(casaId: number, db: Db = prisma): Promise<void> {
  const cota = await obterCotaDaCasa(casaId, db);
  if (cota.membros.emUso + 1 > cota.membros.limite) {
    throw new HttpError(409, CODIGOS_ERRO.LIMITE_MEMBROS, 'Limite de membros do plano atingido', {
      plano: cota.plano.nome,
      limiteMembros: cota.membros.limite,
      membrosEmUso: cota.membros.emUso,
    });
  }
}

/** Base do `COTA_EXCEDIDA` (RF39), consumida pelo M3: cabem mais `bytes` no armazenamento do plano vigente? */
export async function podeEnviarBytes(casaId: number, bytes: number, db: Db = prisma): Promise<boolean> {
  const { armazenamento } = await obterCotaDaCasa(casaId, db);
  return armazenamento.usadoBytes + bytes <= armazenamento.limiteBytes;
}

/** Lança 409 `COTA_EXCEDIDA` se o envio de `bytes` ultrapassa a cota de armazenamento (RF39). */
export async function exigirCotaParaEnvio(casaId: number, bytes: number, db: Db = prisma): Promise<void> {
  const { plano, armazenamento } = await obterCotaDaCasa(casaId, db);
  if (armazenamento.usadoBytes + bytes > armazenamento.limiteBytes) {
    throw new HttpError(409, CODIGOS_ERRO.COTA_EXCEDIDA, 'Limite de armazenamento do plano atingido', {
      plano: plano.nome,
      usadoBytes: armazenamento.usadoBytes,
      limiteBytes: armazenamento.limiteBytes,
    });
  }
}
