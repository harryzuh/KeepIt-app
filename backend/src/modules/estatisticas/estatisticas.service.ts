import { Prisma } from '@prisma/client';
import { CODIGOS_ERRO, HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { obterCotaDaCasa } from '../assinatura/plano.service.js';
import type { Estatisticas, LinhaTag, ProdutoValor, Resumo } from './estatisticas.schema.js';

/**
 * MODEL · Estatísticas da Casa (M4: UC017, UC027, RF23, RF24). Contrato: docs/api/m4-estatisticas.md; decisões: ADR 0004.
 *
 * - Só leitura. Toda consulta filtra por `casaId` (parâmetro vinculado do `Prisma.sql`; `$queryRawUnsafe` é proibido).
 * - Valor do produto = preço × quantidade, somado em `numeric` no banco e devolvido como texto (nunca Number).
 * - Agregação no banco: nenhum produto é carregado em memória, sem N+1.
 * - Cada rota roda em uma transação somente leitura REPEATABLE READ (consistência entre as consultas, ADR 0004 Q7).
 */

type Tx = Prisma.TransactionClient;

/** Espera por conexão do pool (curta: melhor falhar rápido com 503 do que enfileirar todas as Casas). */
const ESPERA_MAXIMA_MS = 1_000;
/** Teto de cada consulta dentro da transação (SET LOCAL statement_timeout; AppSec F-02). */
export const STATEMENT_TIMEOUT_MS = 3_000;
/** Teto da transação inteira (todas as consultas da rota). */
const TIMEOUT_TRANSACAO_MS = 8_000;

export interface OpcoesLeitura {
  statementTimeoutMs?: number;
  maxWaitMs?: number;
  timeoutMs?: number;
}

/** Statement timeout (SQLSTATE 57014), transação expirada ou espera de conexão esgotada (Prisma P2028). */
function ehIndisponibilidade(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2028') return true;
    const meta = err.meta as { code?: string; message?: string } | undefined;
    if (meta?.code === '57014') return true;
  }
  const msg = err instanceof Error ? err.message : '';
  return /statement timeout|canceling statement|Unable to start a transaction|Transaction API error/i.test(msg);
}

/**
 * Transação somente leitura REPEATABLE READ com teto de tempo por consulta.
 * Lentidão ou falta de conexão viram 503 ESTATISTICAS_INDISPONIVEL (sem vazar SQL); outros erros seguem para o 500.
 */
export async function lerEmTransacao<T>(fn: (tx: Tx) => Promise<T>, opcoes: OpcoesLeitura = {}): Promise<T> {
  const statementTimeoutMs = Math.trunc(opcoes.statementTimeoutMs ?? STATEMENT_TIMEOUT_MS);
  try {
    return await prisma.$transaction(
      async (tx) => {
        // set_config com parâmetro (SET LOCAL não aceita parâmetro); vale só até o fim da transação.
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(statementTimeoutMs)}, true)`;
        return fn(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: opcoes.maxWaitMs ?? ESPERA_MAXIMA_MS,
        timeout: opcoes.timeoutMs ?? TIMEOUT_TRANSACAO_MS,
      },
    );
  } catch (err) {
    if (ehIndisponibilidade(err)) {
      throw new HttpError(503, CODIGOS_ERRO.ESTATISTICAS_INDISPONIVEL, 'Estatísticas indisponíveis no momento');
    }
    throw err;
  }
}

const LIMITE_LINHAS_TAG = 50;
const LIMITE_MAIS_ANTIGOS = 5;

/** Expressão do valor do produto, com 2 casas, para texto. */
const VALOR = Prisma.sql`(p.preco * p.quantidade)::numeric(30,2)`;

export interface Totais {
  valorTotal: string;
  produtos: number;
  unidades: number;
  valorMedio: string;
}

/** Fonte ÚNICA de valor total, contagens e valor médio (Resumo e tela 10 não podem divergir). */
export async function obterTotais(tx: Tx, casaId: number): Promise<Totais> {
  const [linha] = await tx.$queryRaw<{ valor_total: string; produtos: number; unidades: bigint; valor_medio: string }[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(p.preco * p.quantidade), 0)::numeric(30,2)::text AS valor_total,
      COUNT(*)::int AS produtos,
      COALESCE(SUM(p.quantidade), 0)::bigint AS unidades,
      CASE WHEN COUNT(*) = 0 THEN 0::numeric(30,2)
           ELSE ROUND(SUM(p.preco * p.quantidade) / COUNT(*), 2)::numeric(30,2) END::text AS valor_medio
    FROM produto p
    WHERE p.casa_id = ${casaId}`);
  return {
    valorTotal: linha.valor_total,
    produtos: linha.produtos,
    unidades: Number(linha.unidades),
    valorMedio: linha.valor_medio,
  };
}

interface LinhaProduto {
  id: number;
  nome: string;
  preco: string;
  quantidade: number;
  valor: string;
  data_compra: string;
}

function paraProdutoValor(l: LinhaProduto): ProdutoValor {
  return { id: l.id, nome: l.nome, preco: l.preco, quantidade: l.quantidade, valor: l.valor, dataCompra: l.data_compra };
}

const COLUNAS_PRODUTO = Prisma.sql`
  p.id, p.nome, p.preco::numeric(30,2)::text AS preco, p.quantidade, ${VALOR}::text AS valor,
  to_char(p.data_compra, 'YYYY-MM-DD') AS data_compra`;

async function obterMaiorGasto(tx: Tx, casaId: number): Promise<ProdutoValor | null> {
  const linhas = await tx.$queryRaw<LinhaProduto[]>(Prisma.sql`
    SELECT ${COLUNAS_PRODUTO} FROM produto p WHERE p.casa_id = ${casaId}
    ORDER BY p.preco * p.quantidade DESC, p.data_compra DESC, p.id ASC LIMIT 1`);
  return linhas[0] ? paraProdutoValor(linhas[0]) : null;
}

async function obterMaisAntigos(tx: Tx, casaId: number): Promise<ProdutoValor[]> {
  const linhas = await tx.$queryRaw<LinhaProduto[]>(Prisma.sql`
    SELECT ${COLUNAS_PRODUTO} FROM produto p WHERE p.casa_id = ${casaId}
    ORDER BY p.data_compra ASC, p.data_cadastro ASC, p.id ASC LIMIT ${LIMITE_MAIS_ANTIGOS}`);
  return linhas.map(paraProdutoValor);
}

interface LinhaTagBruta {
  id: number;
  nome: string;
  valor: string;
  unidades: bigint;
  produtos: number;
}

const paraLinhaTag = (l: LinhaTagBruta): LinhaTag => ({
  id: l.id,
  nome: l.nome,
  valor: l.valor,
  unidades: Number(l.unidades),
  produtos: l.produtos,
});

/** Agregado por tag (só tags com produto). O filtro de `casaId` vale para a tag E para o produto. */
const POR_TAG = Prisma.sql`
  t.id, t.nome,
  SUM(p.preco * p.quantidade)::numeric(30,2)::text AS valor,
  SUM(p.quantidade)::bigint AS unidades,
  COUNT(*)::int AS produtos`;

async function obterValorPorTag(tx: Tx, casaId: number): Promise<LinhaTag[]> {
  const linhas = await tx.$queryRaw<LinhaTagBruta[]>(Prisma.sql`
    SELECT ${POR_TAG}
    FROM tag t
    JOIN produto_tag pt ON pt.tag_id = t.id
    JOIN produto p ON p.id = pt.produto_id AND p.casa_id = t.casa_id
    WHERE t.casa_id = ${casaId}
    GROUP BY t.id, t.nome
    ORDER BY SUM(p.preco * p.quantidade) DESC, lower(t.nome) ASC, t.id ASC
    LIMIT ${LIMITE_LINHAS_TAG}`);
  return linhas.map(paraLinhaTag);
}

async function obterTagMaisComprada(tx: Tx, casaId: number): Promise<Estatisticas['tagMaisComprada']> {
  const linhas = await tx.$queryRaw<LinhaTagBruta[]>(Prisma.sql`
    SELECT ${POR_TAG}
    FROM tag t
    JOIN produto_tag pt ON pt.tag_id = t.id
    JOIN produto p ON p.id = pt.produto_id AND p.casa_id = t.casa_id
    WHERE t.casa_id = ${casaId}
    GROUP BY t.id, t.nome
    ORDER BY SUM(p.quantidade) DESC, COUNT(*) DESC, lower(t.nome) ASC, t.id ASC
    LIMIT 1`);
  if (!linhas[0]) return null;
  const { id, nome, unidades, produtos } = paraLinhaTag(linhas[0]);
  return { id, nome, unidades, produtos };
}

async function contarTagsComProduto(tx: Tx, casaId: number): Promise<number> {
  const [linha] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT pt.tag_id)::int AS total
    FROM produto_tag pt
    JOIN tag t ON t.id = pt.tag_id
    JOIN produto p ON p.id = pt.produto_id AND p.casa_id = t.casa_id
    WHERE t.casa_id = ${casaId}`);
  return linha.total;
}

async function obterSemTag(tx: Tx, casaId: number): Promise<Estatisticas['semTag']> {
  const [linha] = await tx.$queryRaw<{ valor: string; unidades: bigint; produtos: number }[]>(Prisma.sql`
    SELECT COALESCE(SUM(p.preco * p.quantidade), 0)::numeric(30,2)::text AS valor,
           COALESCE(SUM(p.quantidade), 0)::bigint AS unidades,
           COUNT(*)::int AS produtos
    FROM produto p
    WHERE p.casa_id = ${casaId} AND NOT EXISTS (SELECT 1 FROM produto_tag pt WHERE pt.produto_id = p.id)`);
  if (linha.produtos === 0) return null;
  return { valor: linha.valor, unidades: Number(linha.unidades), produtos: linha.produtos };
}

/** GET /estatisticas/resumo (telas 05 e 17). */
export async function obterResumo(casaId: number): Promise<Resumo> {
  return lerEmTransacao(async (tx) => {
    const totais = await obterTotais(tx, casaId);
    const tags = await tx.tag.count({ where: { casaId } });
    const cota = await obterCotaDaCasa(casaId, tx);
    return {
      valorTotal: totais.valorTotal,
      produtos: totais.produtos,
      unidades: totais.unidades,
      tags,
      membros: cota.membros,
      armazenamento: cota.armazenamento,
      plano: { nome: cota.plano.nome },
      renovacao: cota.assinatura
        ? { status: cota.assinatura.status, data: cota.assinatura.dataRenovacao.toISOString() }
        : null,
    };
  });
}

/** GET /estatisticas (tela 10). */
export async function obterEstatisticas(casaId: number): Promise<Estatisticas> {
  return lerEmTransacao(async (tx) => {
    const totais = await obterTotais(tx, casaId);
    const vazia = totais.produtos === 0;
    // Casa vazia: nenhuma consulta extra (e nada de divisão por zero).
    const [maiorGasto, tagMaisComprada, valorPorTag, totalTagsComProduto, semTag, maisAntigos] = vazia
      ? [null, null, [] as LinhaTag[], 0, null, [] as ProdutoValor[]]
      : [
          await obterMaiorGasto(tx, casaId),
          await obterTagMaisComprada(tx, casaId),
          await obterValorPorTag(tx, casaId),
          await contarTagsComProduto(tx, casaId),
          await obterSemTag(tx, casaId),
          await obterMaisAntigos(tx, casaId),
        ];
    return { ...totais, maiorGasto, tagMaisComprada, valorPorTag, totalTagsComProduto, semTag, maisAntigos };
  });
}
