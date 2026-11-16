import { centavos } from '@/lib/format';
import type { LinhaTag } from './tipos';

/** Uso do armazenamento em % inteiro (0 a 100) a partir dos bytes; limite zero conta como cheio. */
export function percentualArmazenamento(usadoBytes: number, limiteBytes: number): number {
  if (limiteBytes <= 0) return 100;
  return Math.min(100, Math.round((usadoBytes / limiteBytes) * 100));
}

/** Há sobreposição quando a soma das tags passa do valor total (produto com várias tags conta em cada uma). */
export function haSobreposicao(linhas: LinhaTag[], valorTotal: string): boolean {
  const total = centavos(valorTotal);
  if (total === null) return false;
  const soma = linhas.reduce((acc, l) => acc + (centavos(l.valor) ?? 0n), 0n);
  return soma > total;
}

/** Nome de exibição do plano: FAMILIA vira "Família". */
export const nomeDoPlano = (nome: string) => (nome === 'FAMILIA' ? 'Família' : nome.charAt(0) + nome.slice(1).toLowerCase());

/** "3 unidades" / "1 unidade". */
export const unidadesTexto = (n: number) => `${n.toLocaleString('pt-BR')} ${n === 1 ? 'unidade' : 'unidades'}`;
export const produtosTexto = (n: number) => `${n.toLocaleString('pt-BR')} ${n === 1 ? 'produto' : 'produtos'}`;
