import { z } from 'zod';
import '../../config/zod.js';
import { normalizarLinha, temControleOuFormatacao } from '../../lib/texto.js';

/** CONTRATO · schemas Zod das tags (docs/api/m3-produtos.md, seções 3.1 e 3.2). */

export const TAG_NOME_MAX = 40;

export const criarTagSchema = z.object({
  nome: z
    .string({ error: 'Informe o nome da tag' })
    .refine((s) => !temControleOuFormatacao(s), 'O nome da tag não pode conter caracteres de controle ou invisíveis')
    .transform((s) => normalizarLinha(s).trim())
    .pipe(
      z
        .string()
        .min(1, 'Informe o nome da tag')
        .max(TAG_NOME_MAX, `O nome da tag deve ter até ${TAG_NOME_MAX} caracteres`)
        .refine((s) => !/[<>]/.test(s), 'O nome da tag não pode conter < ou >'),
    ),
});

export type CriarTagDto = z.infer<typeof criarTagSchema>;
