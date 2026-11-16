import { formatBRL } from '@/lib/format';
import type { NomePlano, PlanoDetalhe } from './tipos';

export const nomeDoPlano = (n: NomePlano) => ({ INDIVIDUAL: 'Individual', FAMILIA: 'Família', BUSINESS: 'Business' })[n];
export const precoDoPlano = (p: Pick<PlanoDetalhe, 'preco'>) => formatBRL(Number(p.preco));
export const planoParaUrl = (n: NomePlano) => n.toLowerCase();
export const MARCAS = { VISA: 'Visa', MASTERCARD: 'Mastercard', AMEX: 'Amex', ELO: 'Elo', OUTRA: 'Cartão' } as const;

/** Bytes em GB (base binária, como a API). */
export function formatGb(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return `${gb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
}

export const BENEFICIOS: Record<NomePlano, string> = {
  INDIVIDUAL: 'Estatísticas básicas',
  FAMILIA: 'Papéis Editor e Leitor',
  BUSINESS: 'Suporte prioritário',
};
