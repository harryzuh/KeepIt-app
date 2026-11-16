import { z } from 'zod';

// Regras espelham docs/api/m5-assinatura.md (3.3); a API continua sendo a autoridade.
const soDigitos = (v: string) => v.replace(/[\s-]/g, '');

/**
 * Pagamento simulado: só estes cartões de teste são aceitos (espelha CARTOES_DE_TESTE do backend).
 * Nenhum cartão real deve sair do navegador.
 */
export const CARTOES_DE_TESTE = { aprovado: '4242 4242 4242 4242', recusado: '4111 1100 0005 0000' } as const;
const ehCartaoDeTeste = (v: string) => Object.values(CARTOES_DE_TESTE).some((c) => soDigitos(c) === soDigitos(v));

/** Algoritmo de Luhn. */
export function luhnValido(digitos: string): boolean {
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

/** Vale até o último dia do mês informado. */
export function validadeVigente(v: string, agora = new Date()): boolean {
  const m = /^(\d{2})\/(\d{2})$/.exec(v);
  if (!m) return false;
  const mes = Number(m[1]);
  if (mes < 1 || mes > 12) return false;
  const ano = 2000 + Number(m[2]);
  return ano > agora.getFullYear() || (ano === agora.getFullYear() && mes >= agora.getMonth() + 1);
}

export const cartaoSchema = z.object({
  numero: z
    .string()
    .min(1, 'Informe o número do cartão')
    .refine((v) => /^\d{13,19}$/.test(soDigitos(v)), 'O número deve ter de 13 a 19 dígitos')
    .refine((v) => !/^\d{13,19}$/.test(soDigitos(v)) || luhnValido(soDigitos(v)), 'Número de cartão inválido')
    .refine(
      (v) => !/^\d{13,19}$/.test(soDigitos(v)) || !luhnValido(soDigitos(v)) || ehCartaoDeTeste(v),
      `Pagamento simulado: use o cartão de teste ${CARTOES_DE_TESTE.aprovado}`,
    ),
  validade: z
    .string()
    .min(1, 'Informe a validade')
    .regex(/^\d{2}\/\d{2}$/, 'Use o formato MM/AA')
    .refine((v) => !/^\d{2}\/\d{2}$/.test(v) || validadeVigente(v), 'Cartão vencido ou mês inválido'),
  // Nome do titular e CVV não são coletados (contrato 3.3).
});

export const cancelamentoSchema = z.object({
  motivo: z.string().trim().max(300, 'Máximo de 300 caracteres'),
});

export type CartaoForm = z.infer<typeof cartaoSchema>;
export type CancelamentoForm = z.infer<typeof cancelamentoSchema>;
