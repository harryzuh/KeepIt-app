/**
 * Conflitos de concorrência do Postgres: impasse (40P01) e falha de serialização (40001).
 * O Prisma os expõe como P2034 ou, em consultas brutas, como P2010/P2004 com `meta.code` (ou na mensagem).
 */
const SQLSTATES = ['40P01', '40001'];

export function ehConflitoDeConcorrencia(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as { code?: unknown; meta?: { code?: unknown; message?: unknown } };
  if (e.code === 'P2034') return true;
  if (typeof e.meta?.code === 'string' && SQLSTATES.includes(e.meta.code)) return true;
  const texto = `${typeof e.meta?.message === 'string' ? e.meta.message : ''} ${err.message}`;
  return SQLSTATES.some((c) => texto.includes(c)) || /deadlock detected/i.test(texto);
}

/** Repete `fn` quando ela falha por conflito de concorrência (a transação inteira é refeita do zero). */
export async function comNovasTentativas<T>(fn: () => Promise<T>, tentativas = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tentativas || !ehConflitoDeConcorrencia(err)) throw err;
    }
  }
}
