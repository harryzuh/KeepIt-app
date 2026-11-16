import { randomUUID } from 'node:crypto';
import type { MarcaCartao } from '@prisma/client';
import { env } from '../../config/env.js';
import { CODIGOS_ERRO, HttpError } from '../../lib/http-error.js';

/**
 * MODEL · Gateway de pagamento SIMULADO (ADR 0002, D5). Função pura, sem I/O: pode ser trocada por um gateway
 * real no backlog. Aprova por padrão; recusa quando o cartão do titular termina em `0000`.
 * Cartão de teste de recusa: 4111 1100 0005 0000. Cartão de teste aprovado: 4242 4242 4242 4242.
 */

export const FINAL_CARTAO_RECUSADO = '0000';

/** Únicos números aceitos (cartões de teste): aprovado e recusado. Nenhum PAN real trafega pelo servidor. */
export const CARTOES_DE_TESTE: readonly string[] = ['4242424242424242', '4111110000050000'];

/** Barra qualquer cobrança ou cadastro de cartão quando o gateway simulado está desligado (produção sem gateway real). */
export function exigirGatewaySimulado(simulado: boolean = env.PAGAMENTO_SIMULADO): void {
  if (!simulado) {
    throw new HttpError(503, CODIGOS_ERRO.PAGAMENTO_INDISPONIVEL, 'Pagamento indisponível no momento');
  }
}

export interface ResultadoCobranca {
  aprovado: boolean;
  /** Referência da cobrança simulada (`sim_<uuid>`), gravada em `Assinatura.refPagamento` quando aprovada. */
  referencia: string | null;
}

/** `ultimos4` ausente (usuário sem método) conta como recusa. */
export function cobrarSimulado(ultimos4: string | null | undefined): ResultadoCobranca {
  exigirGatewaySimulado();
  if (!ultimos4 || ultimos4 === FINAL_CARTAO_RECUSADO) return { aprovado: false, referencia: null };
  return { aprovado: true, referencia: `sim_${randomUUID()}` };
}

const PREFIXOS_ELO = [
  '4011', '4312', '4389', '4514', '4576', '5041', '5066', '5067', '509', '6277', '6362', '6363', '650', '6516', '6550',
];

/** Detecta a marca pelo prefixo do número (só dígitos). */
export function detectarMarca(numero: string): MarcaCartao {
  if (PREFIXOS_ELO.some((p) => numero.startsWith(p))) return 'ELO';
  if (/^3[47]/.test(numero)) return 'AMEX';
  if (/^5[1-5]/.test(numero) || /^2(2[2-9]\d|[3-6]\d\d|7[01]\d|720)/.test(numero)) return 'MASTERCARD';
  if (numero.startsWith('4')) return 'VISA';
  return 'OUTRA';
}
