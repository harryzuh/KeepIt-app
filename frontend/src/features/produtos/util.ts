/** Utilidades de produto: preço no formato brasileiro, data de hoje e rótulos do histórico. */

/** "1.234,50" ou "1234,5" ou "1234.50" → "1234.50" (string decimal da API). Devolve null se inválido. */
export function precoParaApi(texto: string): string | null {
  const t = texto.trim().replace(/^R\$\s*/, '');
  if (!t) return null;
  let normal: string;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) normal = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+(,\d{1,2})?$/.test(t)) normal = t.replace(',', '.');
  else if (/^\d+\.\d{1,2}$/.test(t)) normal = t;
  else return null;
  const [int, dec = ''] = normal.split('.');
  return `${int}.${dec.padEnd(2, '0')}`;
}

/** "249.90" → "249,90" (valor do campo de edição). */
export const precoParaCampo = (preco: string) => preco.replace('.', ',');

/** Data de hoje em AAAA-MM-DD no fuso de São Paulo (a API recusa data futura nesse fuso). */
export function hojeIso(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

/** "AAAA-MM-DD" → "15/03/2026" sem mudar de dia por fuso. */
export function formatDataCompra(d: string): string {
  const [a, m, dia] = d.split('-');
  return `${dia}/${m}/${a}`;
}
