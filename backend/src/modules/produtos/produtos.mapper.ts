import type { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { assinarLeitura } from '../../lib/s3.js';
import { compararTags } from '../tags/tags.service.js';

/**
 * MODEL · conversão das linhas do banco para os tipos do contrato (docs/api/m3-produtos.md, seção 2).
 * Preço sempre string decimal; datas em ISO 8601 UTC; fotos com URL ASSINADA de leitura (o bucket nunca é público).
 */

export const INCLUIR_PRODUTO = {
  tags: { include: { tag: { select: { id: true, nome: true } } } },
  fotos: { orderBy: [{ ordem: 'asc' }, { id: 'asc' }] },
  adicionadoPor: { select: { id: true, nome: true } },
} satisfies Prisma.ProdutoInclude;

export type ProdutoCompleto = Prisma.ProdutoGetPayload<{ include: typeof INCLUIR_PRODUTO }>;

export interface FotoLeitura {
  url: string;
  expiraEm: string;
}

/** `AAAA-MM-DD` de uma coluna `@db.Date` (o Prisma a devolve como meia-noite UTC). */
export const dataSemHora = (d: Date): string => d.toISOString().slice(0, 10);

export async function leituraDaFoto(chave: string): Promise<FotoLeitura> {
  const expiraEm = new Date(Date.now() + env.S3_READ_URL_TTL_S * 1000);
  return { url: await assinarLeitura(chave), expiraEm: expiraEm.toISOString() };
}

function tagsOrdenadas(p: ProdutoCompleto) {
  return p.tags.map((t) => ({ id: t.tag.id, nome: t.tag.nome })).sort(compararTags);
}

function base(p: ProdutoCompleto) {
  return {
    id: p.id,
    nome: p.nome,
    preco: p.preco.toFixed(2),
    quantidade: p.quantidade,
    dataCompra: dataSemHora(p.dataCompra),
    dataCadastro: p.dataCadastro.toISOString(),
    tags: tagsOrdenadas(p),
    adicionadoPor: p.adicionadoPor ? { id: p.adicionadoPor.id, nome: p.adicionadoPor.nome } : null,
  };
}

/** Item das listas (telas 05, 06 e 17). */
export async function paraResumo(p: ProdutoCompleto) {
  const capa = p.fotos[0];
  return { ...base(p), fotoCapa: capa ? await leituraDaFoto(capa.chave) : null };
}

/** Tela 07. */
export async function paraDetalhe(p: ProdutoCompleto) {
  const fotos = await Promise.all(
    p.fotos.map(async (f) => ({
      id: f.id,
      ordem: f.ordem,
      tipo: f.tipo,
      tamanhoBytes: f.tamanhoBytes,
      ...(await leituraDaFoto(f.chave)),
    })),
  );
  return { ...base(p), descricao: p.descricao, fotos, atualizadoEm: p.atualizadoEm.toISOString() };
}
