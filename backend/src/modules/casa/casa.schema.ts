import { z } from 'zod';
import { emailSchema, idSchema } from '../../lib/campos.js';

/** CONTRATO · schemas Zod do M2 (docs/api/m2-casa.md). O front-end se baseia nestes campos. */

/** Papéis atribuíveis a membros: ninguém vira ADMIN por estas rotas (ADR 0002, I2). */
const papelDeMembroSchema = z.enum(['EDITOR', 'LEITOR'], { error: 'Papel inválido: use EDITOR ou LEITOR' });

export const adicionarMembroSchema = z.object({
  email: emailSchema,
  papel: papelDeMembroSchema.default('LEITOR'),
});

export const alterarPapelSchema = z.object({ papel: papelDeMembroSchema });

/** `:usuarioId` das rotas de membro: inteiro positivo (senão 422 DADOS_INVALIDOS). */
export const membroParamsSchema = z.object({ usuarioId: idSchema });

export const renomearCasaSchema = z.object({
  nome: z
    .string({ error: 'Informe o nome da Casa' })
    .trim()
    .min(1, 'Informe o nome da Casa')
    .max(80, 'O nome da Casa deve ter até 80 caracteres')
    // Sem `<`/`>` (marcação/phishing) nem caracteres de controle (quebra de linha em e-mail e logs).
    .refine((s) => !/[<>]/.test(s), 'O nome da Casa não pode conter < ou >')
    .refine((s) => !/[\p{Cc}\p{Cf}]/u.test(s), 'O nome da Casa não pode conter caracteres de controle ou de formatação'),
});

export type AdicionarMembroDto = z.infer<typeof adicionarMembroSchema>;
export type AlterarPapelDto = z.infer<typeof alterarPapelSchema>;
export type RenomearCasaDto = z.infer<typeof renomearCasaSchema>;
