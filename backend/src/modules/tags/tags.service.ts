import { Prisma, type PrismaClient } from '@prisma/client';
import { ACOES_AUDITORIA, registrarAuditoria } from '../../lib/auditoria.js';
import { CODIGOS_ERRO, HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import type { UsuarioAutenticado } from '../../middlewares/autenticar.js';
import type { CriarTagDto } from './tags.schema.js';

/**
 * MODEL · Tags da Casa (M3: UC023, RF35). Contrato em docs/api/m3-produtos.md.
 * Só criar e listar (editar/excluir tag está no backlog). Unicidade por Casa sem diferenciar caixa:
 * índice único funcional (casa_id, lower(nome)) no banco + verificação antes de gravar.
 */

export interface TagDaCasa {
  id: number;
  nome: string;
}

/** Ordem alfabética sem diferenciar caixa nem acento (desempate por id). */
export function compararTags(a: TagDaCasa, b: TagDaCasa): number {
  return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }) || a.id - b.id;
}

/** Tag da Casa com o mesmo nome, sem diferenciar caixa (comparação literal, sem curingas). */
async function buscarPorNome(db: Prisma.TransactionClient | PrismaClient, casaId: number, nome: string): Promise<TagDaCasa | null> {
  const linhas = await db.$queryRaw<TagDaCasa[]>`
    SELECT id, nome FROM tag WHERE casa_id = ${casaId} AND lower(nome) = lower(${nome}) ORDER BY id LIMIT 1`;
  return linhas[0] ?? null;
}

const tagExistente = (existente: TagDaCasa) =>
  new HttpError(409, CODIGOS_ERRO.TAG_EXISTENTE, 'Esta tag já existe', { existente });

/** GET /tags: todas as tags da Casa do token, com a quantidade de produtos de cada uma. */
export async function listarTags(casaId: number) {
  const tags = await prisma.tag.findMany({
    where: { casaId },
    select: { id: true, nome: true, _count: { select: { produtos: true } } },
  });
  tags.sort(compararTags);
  return { itens: tags.map((t) => ({ id: t.id, nome: t.nome, quantidadeProdutos: t._count.produtos })) };
}

/** POST /tags: cria a tag (ADMIN e EDITOR). Nome já existente (sem diferenciar caixa) → 409 TAG_EXISTENTE. */
export async function criarTag(usuario: UsuarioAutenticado, dto: CriarTagDto): Promise<TagDaCasa> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existente = await buscarPorNome(tx, usuario.casaId, dto.nome);
      if (existente) throw tagExistente(existente);
      const tag = await tx.tag.create({ data: { casaId: usuario.casaId, nome: dto.nome }, select: { id: true, nome: true } });
      await registrarAuditoria(
        {
          usuarioId: usuario.id,
          casaId: usuario.casaId,
          acao: ACOES_AUDITORIA.TAG_CRIADA,
          entidade: 'Tag',
          entidadeId: tag.id,
          detalhes: { nome: tag.nome },
        },
        tx,
      );
      return tag;
    });
  } catch (err) {
    // Duas criações simultâneas do mesmo nome: a segunda esbarra no índice único funcional.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existente = await buscarPorNome(prisma, usuario.casaId, dto.nome);
      if (existente) throw tagExistente(existente);
    }
    throw err;
  }
}
