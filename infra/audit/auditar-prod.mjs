// Porta de auditoria de dependências de produção do backend (RNF, defeito de segurança da Sprint 4).
// Uso: npm audit --omit=dev --json | node infra/audit/auditar-prod.mjs
// Falha (exit 1) se houver vulnerabilidade alta/crítica fora da exceção documentada abaixo.
// Exceção: GHSA-ggr8-5vv4-36mx (deepmerge-ts < 8.0.0) na cadeia prisma > @prisma/config > deepmerge-ts.
// A CLI do Prisma só lê o prisma.config do próprio projeto no deploy (migrate deploy); não há entrada de
// usuário nem caminho pela API. A correção exige Prisma 7 (mudança com quebra): sprint própria.
// A exceção EXPIRA na data abaixo para não virar dívida eterna.
import { readFileSync } from 'node:fs';

export const EXCECAO = {
  advisory: 'GHSA-ggr8-5vv4-36mx',
  pacotes: ['deepmerge-ts', '@prisma/config', 'prisma'],
  expiraEm: '2027-03-31',
};

export function avaliar(relatorio, hoje = new Date()) {
  const vulns = Object.values(relatorio.vulnerabilities ?? {});
  const graves = vulns.filter((v) => v.severity === 'high' || v.severity === 'critical');
  const expirada = hoje > new Date(`${EXCECAO.expiraEm}T23:59:59Z`);
  const fora = graves.filter((v) => {
    if (expirada || !EXCECAO.pacotes.includes(v.name)) return true;
    // Pacote direto da exceção: confere se todos os advisories diretos são o autorizado.
    const diretos = (v.via ?? []).filter((x) => typeof x === 'object');
    return diretos.some((x) => !String(x.url ?? '').endsWith(EXCECAO.advisory));
  });
  return { graves: graves.map((v) => v.name), fora: fora.map((v) => v.name), expirada };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = avaliar(JSON.parse(readFileSync(0, 'utf8')));
  if (r.fora.length) {
    console.error(`Auditoria reprovada${r.expirada ? ' (exceção expirada)' : ''}: ${r.fora.join(', ')}`);
    process.exit(1);
  }
  console.log(`Auditoria ok (${r.graves.length} alta(s) cobertas pela exceção ${EXCECAO.advisory}, vence em ${EXCECAO.expiraEm}).`);
}
