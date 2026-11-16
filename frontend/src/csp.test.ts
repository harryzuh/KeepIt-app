import { readFileSync } from 'node:fs';
import { montarCsp } from '../csp';

describe('CSP (ACH-04)', () => {
  const politica = montarCsp('https://api.keepit.app');

  it('scripts só do próprio domínio e connect-src só para a API', () => {
    expect(politica).toContain("script-src 'self'");
    expect(politica).not.toMatch(/unsafe-(inline|eval)/);
    expect(politica).toContain("connect-src 'self' https://api.keepit.app");
    expect(politica).toContain("object-src 'none'");
  });

  it('libera o domínio do bucket em connect-src e img-src só quando informado', () => {
    const com = montarCsp('https://api.keepit.app', 'https://fotos.keepit.app/bucket');
    expect(com).toContain("connect-src 'self' https://api.keepit.app https://fotos.keepit.app");
    expect(com).toContain("img-src 'self' data: blob: https://fotos.keepit.app");
    expect(politica).toContain("img-src 'self' data: blob:;");
  });

  it('index.html não depende de CSS/fonte externos', () => {
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/googleapis|gstatic/);
  });

  it('vercel.json define frame-ancestors e nosniff', () => {
    const v = readFileSync('vercel.json', 'utf8');
    expect(v).toContain("frame-ancestors 'none'");
    expect(v).toContain('nosniff');
  });
});

describe('Cabeçalhos e política de privacidade das fotos', () => {
  it('img-src libera blob: (prévia das fotos) e script-src não', () => {
    const p = montarCsp('https://api.keepit.app');
    expect(p).toMatch(/img-src [^;]*blob:/);
    expect(p.match(/script-src [^;]*/)?.[0]).not.toContain('blob:');
  });

  it('Referrer-Policy same-origin no vercel.json e no index.html (URL assinada não vaza por Referer)', () => {
    expect(readFileSync('vercel.json', 'utf8')).toMatch(/"Referrer-Policy", "value": "same-origin"/);
    expect(readFileSync('index.html', 'utf8')).toMatch(/name="referrer" content="same-origin"/);
  });

  it('ESLint proíbe dangerouslySetInnerHTML, innerHTML e eval', () => {
    const e = readFileSync('eslint.config.js', 'utf8');
    expect(e).toContain('dangerouslySetInnerHTML');
    expect(e).toContain('innerHTML');
    expect(e).toContain("'no-eval'");
  });
});
