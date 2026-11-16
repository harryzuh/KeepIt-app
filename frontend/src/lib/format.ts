export const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatData = (d: string | Date) => new Date(d).toLocaleDateString('pt-BR');

/** Mascara o e-mail (RNF25): `ana.silva@email.com` vira `a***@email.com`. */
export function mascararEmail(email: string): string {
  const [local, dominio] = email.split('@');
  if (!dominio) return email;
  return `${local.slice(0, 1)}***@${dominio}`;
}

export const primeiraLetra = (nome: string) => (nome.trim()[0] ?? '?').toUpperCase();

/** Tamanho em bytes no formato brasileiro: "1,5 MB". */
export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  const un = ['KB', 'MB', 'GB', 'TB'];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < un.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${un[i]}`;
}

/**
 * Dinheiro decimal da API ("12345.67", contrato do M4) em BRL, sem passar por Number:
 * o maior valor possível passa de 2^53 em centavos. Só formata; separa inteiro e decimais como texto.
 */
export function formatDinheiro(valor: string): string {
  const m = /^(\d+)\.(\d{2})$/.exec(valor);
  if (!m) return '—';
  return `R$\u00a0${BigInt(m[1]).toLocaleString('pt-BR')},${m[2]}`;
}

/** "12345.67" → 1234567n (centavos exatos). Valor fora do formato vira null. */
export function centavos(valor: string): bigint | null {
  const m = /^(\d+)\.(\d{2})$/.exec(valor);
  return m ? BigInt(m[1]) * 100n + BigInt(m[2]) : null;
}

/**
 * Participação de `parte` sobre `total` (strings decimais) com 1 casa, em aritmética inteira: "42,5%".
 * Total zero ou inválido devolve null (a tela mostra "—", sem divisão por zero).
 */
export function percentualDe(parte: string, total: string): { texto: string; largura: number } | null {
  const p = centavos(parte);
  const t = centavos(total);
  if (p === null || t === null || t === 0n) return null;
  // p/t em décimos de ponto percentual, arredondado para o mais próximo: (p*1000)/t
  const dec = (p * 2000n + t) / (2n * t);
  const inteiro = dec / 10n;
  const frac = dec % 10n;
  const largura = Math.min(100, Number(dec) / 10);
  return { texto: `${inteiro.toLocaleString('pt-BR')},${frac}%`, largura };
}
