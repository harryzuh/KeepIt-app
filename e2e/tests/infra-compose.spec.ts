import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

// Garante que Postgres e S3 locais só escutam em loopback (checklist 7.5). Teste estático do compose.
const caminho = [resolve(__dirname, '../../docker-compose.yml'), '/workspace/docker-compose.yml'].find(existsSync);

test.describe('docker-compose: portas de dados só em loopback', () => {
  test.skip(!caminho, 'docker-compose.yml não está visível neste ambiente');

  const portas = (): string[] =>
    [...readFileSync(caminho as string, 'utf8').matchAll(/^\s*ports:\s*\[(.*)\]\s*$/gm)].flatMap((m) =>
      m[1].split(',').map((p) => p.trim().replace(/^"|"$/g, '')),
    );

  for (const porta of ['5432', '9000']) {
    test(`porta ${porta} publicada em 127.0.0.1`, () => {
      const mapeamentos = portas().filter((p) => p.endsWith(`:${porta}`));
      expect(mapeamentos.length).toBeGreaterThan(0);
      for (const m of mapeamentos) expect(m.startsWith('127.0.0.1:')).toBe(true);
    });
  }
});
