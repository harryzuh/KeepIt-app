import { defineConfig } from 'vitest/config';

/**
 * Testes que usam banco rodam em um schema separado (`?schema=test`) do mesmo PostgreSQL,
 * para não sujar os dados de desenvolvimento. O global-setup aplica as migrations nesse schema.
 * Ver docs/adr/0001-base-m1.md.
 */
function urlDoBancoDeTeste(): string {
  const base = process.env.DATABASE_URL ?? 'postgresql://keepit:keepit@db:5432/keepit?schema=public';
  const url = new URL(base);
  url.searchParams.set('schema', 'test');
  return url.toString();
}

const DATABASE_URL = urlDoBancoDeTeste();
process.env.DATABASE_URL = DATABASE_URL;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { DATABASE_URL, NODE_ENV: 'test' },
    globalSetup: ['src/test/global-setup.ts'],
    // Os arquivos de teste compartilham o schema `test`: rodam um por vez para não se atropelarem.
    fileParallelism: false,
    hookTimeout: 60_000,
  },
});
