import { z } from 'zod';
import '../../config/zod.js';

/**
 * CONTRATO · schemas Zod de RESPOSTA do M4 (docs/api/m4-estatisticas.md, seções 2 e 3).
 * As rotas não têm entrada (sem corpo, caminho nem query): a Casa vem sempre do token.
 */

/** Dinheiro: string decimal fixa, nunca Number (preço × quantidade passa de 2^53 em centavos). */
export const dinheiroSchema = z.string().regex(/^\d+\.\d{2}$/);
const dataCivilSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const contagemSchema = z.number().int().nonnegative();

export const produtoValorSchema = z.object({
  id: z.number().int(),
  nome: z.string(),
  preco: dinheiroSchema,
  quantidade: contagemSchema,
  valor: dinheiroSchema,
  dataCompra: dataCivilSchema,
});

export const linhaTagSchema = z.object({
  id: z.number().int(),
  nome: z.string(),
  valor: dinheiroSchema,
  unidades: contagemSchema,
  produtos: contagemSchema,
});

export const resumoSchema = z.object({
  valorTotal: dinheiroSchema,
  produtos: contagemSchema,
  unidades: contagemSchema,
  tags: contagemSchema,
  membros: z.object({ emUso: contagemSchema, limite: contagemSchema }),
  armazenamento: z.object({ usadoBytes: contagemSchema, limiteBytes: contagemSchema }),
  plano: z.object({ nome: z.enum(['INDIVIDUAL', 'FAMILIA', 'BUSINESS']) }),
  renovacao: z.object({ status: z.enum(['ATIVA', 'CANCELADA']), data: z.string() }).nullable(),
});

export const estatisticasSchema = z.object({
  valorTotal: dinheiroSchema,
  produtos: contagemSchema,
  unidades: contagemSchema,
  valorMedio: dinheiroSchema,
  maiorGasto: produtoValorSchema.nullable(),
  tagMaisComprada: z
    .object({ id: z.number().int(), nome: z.string(), unidades: contagemSchema, produtos: contagemSchema })
    .nullable(),
  valorPorTag: z.array(linhaTagSchema).max(50),
  totalTagsComProduto: contagemSchema,
  semTag: z.object({ valor: dinheiroSchema, unidades: contagemSchema, produtos: contagemSchema }).nullable(),
  maisAntigos: z.array(produtoValorSchema).max(5),
});

export type ProdutoValor = z.infer<typeof produtoValorSchema>;
export type LinhaTag = z.infer<typeof linhaTagSchema>;
export type Resumo = z.infer<typeof resumoSchema>;
export type Estatisticas = z.infer<typeof estatisticasSchema>;
