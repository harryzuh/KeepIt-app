import { z } from 'zod';
import { hojeIso, precoParaApi } from './util';

// Regras espelham docs/api/m3-produtos.md (seção 1); a API continua sendo a autoridade.
const semMarcacao = (v: string) => !/[<>]/.test(v) && ![...v].some((c) => (c.charCodeAt(0) < 32 && c !== '\n' && c !== '\r' && c !== '\t') || c.charCodeAt(0) === 127);
const semControle = (v: string) => !/[<>]/.test(v) && ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export const produtoFormSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do produto').max(120, 'Máximo de 120 caracteres').refine(semControle, 'Caracteres inválidos'),
  descricao: z.string().trim().max(1000, 'Máximo de 1000 caracteres').refine(semMarcacao, 'Caracteres inválidos'),
  preco: z
    .string()
    .trim()
    .min(1, 'Informe o preço')
    .refine((v) => precoParaApi(v) !== null, 'Use o formato 1.234,50')
    .refine((v) => {
      const p = precoParaApi(v);
      return p === null || Number(p) <= 9_999_999_999.99;
    }, 'Preço acima do permitido'),
  quantidade: z
    .string()
    .trim()
    .min(1, 'Informe a quantidade')
    .regex(/^\d+$/, 'Use um número inteiro')
    .refine((v) => Number(v) >= 1, 'A quantidade mínima é 1')
    .refine((v) => Number(v) <= 1_000_000, 'A quantidade máxima é 1.000.000'),
  dataCompra: z
    .string()
    .min(1, 'Informe a data da compra')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
    .refine((v) => v <= hojeIso(), 'A data da compra não pode ser futura'),
  tagIds: z.array(z.number()).max(10, 'Máximo de 10 tags'),
});

export const novaTagSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da tag').max(40, 'Máximo de 40 caracteres').refine(semControle, 'Caracteres inválidos'),
});

export type ProdutoForm = z.infer<typeof produtoFormSchema>;
