import { z } from 'zod';
import '../../config/zod.js';
import { CARTOES_DE_TESTE } from './gateway-simulado.js';

/** CONTRATO · schemas Zod do M5 (docs/api/m5-assinatura.md). O front-end se baseia nestes campos. */

const SEM_MARCACAO = (s: string) => !/[<>]/.test(s);
/** Sem controle (Cc) nem formatação Unicode (Cf, ex.: U+202E que inverte o texto em logs e e-mails). */
const SEM_CONTROLE = (s: string) => !/[\p{Cc}\p{Cf}]/u.test(s);

/** Algoritmo de Luhn sobre uma string só de dígitos. */
export function passaNoLuhn(digitos: string): boolean {
  let soma = 0;
  let dobrar = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let n = Number(digitos[i]);
    if (dobrar) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    soma += n;
    dobrar = !dobrar;
  }
  return soma % 10 === 0;
}

/** Cartão cujo último mês de validade já passou (vale até o último dia do mês). */
export function validadeVencida(mes: number, ano2digitos: number, agora = new Date()): boolean {
  const ano = 2000 + ano2digitos;
  const primeiroDiaDoMesSeguinte = Date.UTC(ano, mes, 1);
  return agora.getTime() >= primeiroDiaDoMesSeguinte;
}

export const assinarSchema = z.object({
  plano: z.enum(['FAMILIA', 'BUSINESS'], { error: 'Escolha o plano Família ou Business' }),
  confirmaSaidaDaCasa: z.boolean({ error: 'confirmaSaidaDaCasa deve ser verdadeiro ou falso' }).optional(),
});

export const metodoPagamentoSchema = z.object({
  numero: z
    .string({ error: 'Informe o número do cartão' })
    .transform((s) => s.replace(/[\s-]/g, ''))
    .pipe(
      z
        .string()
        .regex(/^\d{13,19}$/, 'O número do cartão deve ter de 13 a 19 dígitos')
        .refine(passaNoLuhn, 'Número de cartão inválido')
        .refine((n) => CARTOES_DE_TESTE.includes(n), 'Pagamento simulado: use um cartão de teste (4242 4242 4242 4242)'),
    ),
  validade: z
    .string({ error: 'Informe a validade' })
    .trim()
    .regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'Use o formato MM/AA')
    .refine((v) => {
      const [mes, ano] = v.split('/').map(Number) as [number, number];
      return !validadeVencida(mes, ano);
    }, 'Cartão vencido'),
});

export const cancelarSchema = z.object({
  motivo: z
    .string({ error: 'Motivo inválido' })
    .trim()
    .max(300, 'O motivo deve ter até 300 caracteres')
    .refine(SEM_MARCACAO, 'O motivo não pode conter < ou >')
    .refine(SEM_CONTROLE, 'O motivo não pode conter caracteres de controle ou de formatação')
    .transform((s) => (s === '' ? undefined : s))
    .optional(),
});

export type AssinarDto = z.infer<typeof assinarSchema>;
export type MetodoPagamentoDto = z.infer<typeof metodoPagamentoSchema>;
export type CancelarDto = z.infer<typeof cancelarSchema>;
