import { z } from 'zod';
import '../config/zod.js';

/**
 * Campos reutilizáveis nos schemas Zod dos módulos (contrato de validação do front).
 * Regras: RNF15 (senha mínima de 8 caracteres) e normalização de e-mail (trim + minúsculas).
 */

/** bcrypt só considera os 72 primeiros BYTES (UTF-8); limitamos em bytes para não aceitar senha "truncada" em silêncio. */
export const SENHA_MIN = 8;
export const SENHA_MAX_BYTES = 72;
export const SENHA_MAX = SENHA_MAX_BYTES;

const cabeNoBcrypt = (s: string) => Buffer.byteLength(s, 'utf8') <= SENHA_MAX_BYTES;

export const emailSchema = z
  .string({ error: 'Informe o e-mail' })
  .trim()
  .toLowerCase()
  .min(1, 'Informe o e-mail')
  .max(120, 'O e-mail deve ter até 120 caracteres')
  .pipe(z.email('E-mail inválido'));

export const senhaSchema = z
  .string({ error: 'Informe a senha' })
  .min(SENHA_MIN, `A senha deve ter no mínimo ${SENHA_MIN} caracteres`)
  .refine(cabeNoBcrypt, `A senha deve ter no máximo ${SENHA_MAX_BYTES} bytes (caracteres acentuados ocupam mais de um)`);

/** Senha atual/login: só exige preenchimento (não revela a política ao atacante). */
export const senhaInformadaSchema = z
  .string({ error: 'Informe a senha' })
  .min(1, 'Informe a senha')
  .refine(cabeNoBcrypt, 'Senha inválida');

export const nomeSchema = z
  .string({ error: 'Informe o nome' })
  .trim()
  .min(1, 'Informe o nome')
  .max(80, 'O nome deve ter até 80 caracteres')
  // Sem `<`/`>` (marcação/phishing) nem caracteres de controle (quebra de linha em e-mail e logs).
  .refine((s) => !/[<>]/.test(s), 'O nome não pode conter < ou >')
  .refine((s) => !/\p{Cc}/u.test(s), 'O nome não pode conter caracteres de controle');

/** Código numérico de verificação (6 dígitos). */
export const codigoSchema = z
  .string({ error: 'Informe o código' })
  .trim()
  .regex(/^\d{6}$/, 'O código deve ter 6 dígitos');

/** Refinamento reutilizável: `confirmarSenha` igual ao campo de senha informado. */
export function exigirConfirmacao<T extends z.ZodType<Record<string, unknown>>>(
  schema: T,
  campoSenha: string,
) {
  return schema.refine((v) => v[campoSenha] === v['confirmarSenha'], {
    path: ['confirmarSenha'],
    message: 'As senhas não conferem',
  });
}

export const idSchema = z.coerce.number().int().positive().max(2_147_483_647); // int4 do Postgres: acima disso o Prisma falharia (500)
