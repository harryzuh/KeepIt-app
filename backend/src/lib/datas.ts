/**
 * Soma `meses` de calendário a uma data (UTC), preservando hora e minuto.
 * Se o dia não existir no mês de destino, usa o último dia dele (31/01 + 1 mês = 28/02 ou 29/02).
 * Usada para `dataRenovacao` das assinaturas (ADR 0002, D8).
 */
export function adicionarMeses(data: Date, meses: number): Date {
  const resultado = new Date(data.getTime());
  const dia = resultado.getUTCDate();
  resultado.setUTCDate(1);
  resultado.setUTCMonth(resultado.getUTCMonth() + meses);
  const ultimoDia = new Date(Date.UTC(resultado.getUTCFullYear(), resultado.getUTCMonth() + 1, 0)).getUTCDate();
  resultado.setUTCDate(Math.min(dia, ultimoDia));
  return resultado;
}
