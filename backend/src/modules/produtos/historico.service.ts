import { ACOES_AUDITORIA } from '../../lib/auditoria.js';
import { CODIGOS_ERRO, HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import type { HistoricoQuery } from './produtos.schema.js';

/**
 * MODEL · histórico de adições e alterações de um produto (RF11, tela 07). Lê os eventos de `LogAuditoria`
 * (entidade 'Produto') gravados na mesma transação de cada mudança (ADR 0003 D4). `PRODUTO_EXCLUIDO` não aparece.
 */

const TIPO_POR_ACAO: Record<string, 'CRIADO' | 'ALTERADO' | 'QUANTIDADE_SOMADA'> = {
  [ACOES_AUDITORIA.PRODUTO_CRIADO]: 'CRIADO',
  [ACOES_AUDITORIA.PRODUTO_ALTERADO]: 'ALTERADO',
  [ACOES_AUDITORIA.PRODUTO_QUANTIDADE_SOMADA]: 'QUANTIDADE_SOMADA',
};

/** GET /produtos/:id/historico: mais novo primeiro, paginado. */
export async function listarHistorico(casaId: number, produtoId: number, q: HistoricoQuery) {
  const produto = await prisma.produto.findFirst({ where: { id: produtoId, casaId }, select: { id: true } });
  if (!produto) throw new HttpError(404, CODIGOS_ERRO.NAO_ENCONTRADO, 'Produto não encontrado');

  const where = { casaId, entidade: 'Produto', entidadeId: produtoId, acao: { in: Object.keys(TIPO_POR_ACAO) } };
  const [total, logs] = await Promise.all([
    prisma.logAuditoria.count({ where }),
    prisma.logAuditoria.findMany({
      where,
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      skip: (q.pagina - 1) * q.limite,
      take: q.limite,
      include: { usuario: { select: { id: true, nome: true, membro: { select: { casaId: true } } } } },
    }),
  ]);

  return {
    itens: logs.map((l) => ({
      id: l.id.toString(),
      tipo: TIPO_POR_ACAO[l.acao]!,
      criadoEm: l.criadoEm.toISOString(),
      // Quem não está mais na Casa (saiu ou excluiu a conta) aparece como ex-membro: sem nome (privacidade).
      autor: l.usuario && l.usuario.membro?.casaId === casaId ? { nome: l.usuario.nome } : null,
      detalhes: l.detalhes,
    })),
    pagina: q.pagina,
    limite: q.limite,
    total,
    totalPaginas: Math.ceil(total / q.limite),
  };
}
