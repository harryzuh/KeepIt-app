import { z } from 'zod';

// Regras espelham docs/api/m2-casa.md (3.2 e 3.5); a API continua sendo a autoridade.
export const adicionarMembroSchema = z.object({
  email: z.string().trim().min(1, 'Informe o e-mail').max(120, 'E-mail muito longo').email('E-mail inválido'),
  papel: z.enum(['EDITOR', 'LEITOR']),
});

export const nomeCasaSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'Informe o nome da Casa')
    .max(80, 'Máximo de 80 caracteres')
    .refine((v) => !/[<>]/.test(v) && ![...v].some((c) => c.charCodeAt(0) < 32), 'Caracteres inválidos'),
});

export type AdicionarMembroForm = z.infer<typeof adicionarMembroSchema>;
export type NomeCasaForm = z.infer<typeof nomeCasaSchema>;
