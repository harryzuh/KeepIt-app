import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

// Defeito da Sprint 4 (npm audit): a porta de auditoria tolera só o advisory documentado e a imagem de
// produção não baixa o Prisma em tempo de execução.
const raiz = [resolve(__dirname, '../..'), '/workspace'].find((d) => existsSync(resolve(d, 'infra/audit/auditar-prod.mjs')));
const script = () => resolve(raiz!, 'infra/audit/auditar-prod.mjs');
const rodar = (rel: object) => {
  try {
    return { codigo: 0, saida: execFileSync('node', [script()], { input: JSON.stringify(rel), encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    return { codigo: (e as { status: number }).status, saida: String((e as { stderr: Buffer }).stderr) };
  }
};
const adv = 'https://github.com/advisories/GHSA-ggr8-5vv4-36mx';
const conhecidas = {
  'deepmerge-ts': { name: 'deepmerge-ts', severity: 'high', via: [{ url: adv }] },
  '@prisma/config': { name: '@prisma/config', severity: 'high', via: ['deepmerge-ts'] },
  prisma: { name: 'prisma', severity: 'high', via: ['@prisma/config'] },
};

test.describe('auditoria de dependências de produção', () => {
  test.skip(!raiz, 'infra/ não está visível neste ambiente');

  test('aceita só as 3 altas conhecidas do Prisma', () => {
    expect(rodar({ vulnerabilities: conhecidas }).codigo).toBe(0);
  });
  test('reprova outra vulnerabilidade alta ou crítica', () => {
    const r = rodar({ vulnerabilities: { ...conhecidas, express: { name: 'express', severity: 'high', via: [{ url: 'https://github.com/advisories/GHSA-xxxx' }] } } });
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain('express');
  });
  test('reprova outro advisory no mesmo pacote da exceção', () => {
    const r = rodar({ vulnerabilities: { prisma: { name: 'prisma', severity: 'critical', via: [{ url: 'https://github.com/advisories/GHSA-outro' }] } } });
    expect(r.codigo).toBe(1);
  });
  test('baixas e moderadas não reprovam', () => {
    expect(rodar({ vulnerabilities: { x: { name: 'x', severity: 'moderate', via: [] } } }).codigo).toBe(0);
  });
  test('imagem de produção: sem devDependencies e sem npx baixando o Prisma', () => {
    const f = [resolve(raiz!, 'backend/Dockerfile')].find(existsSync);
    test.skip(!f, 'Dockerfile do backend não visível');
    const d = readFileSync(f!, 'utf8');
    expect(d).toContain('npm prune --omit=dev');
    expect(d).toContain('npx --no-install prisma migrate deploy');
  });
});
