/** Resumo seguro do erro para log: nome e código (Prisma) e, fora do Prisma, a mensagem. Sem argumentos de consulta. */
export function descreverErro(err: unknown): string {
  if (!(err instanceof Error)) return 'erro desconhecido';
  const codigo = (err as { code?: unknown }).code;
  const ehPrisma = err.name.startsWith('PrismaClient');
  const partes = [err.name, typeof codigo === 'string' ? codigo : undefined];
  if (!ehPrisma) partes.push(err.message.slice(0, 300));
  return partes.filter(Boolean).join(' · ');
}
