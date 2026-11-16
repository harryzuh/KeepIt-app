import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_URL, bearer, criarProduto, criarUsuario, expect, FOTOS, test, urlDoS3 } from './helpers';

// Rodada 2 (DevOps): nosniff na borda do bucket, CORS de produção com uma única origem, validação do
// Content-Length assinado (R-M3-1) e cron horário das rotinas (inclui limparFotosOrfas).
const raiz = [resolve(__dirname, '../..'), '/workspace'].find((d) => existsSync(resolve(d, 'infra/s3/cors.json')));

test.describe('M3 · infra de produção', () => {
  test('objeto lido pelo /s3 vem com X-Content-Type-Options: nosniff', async ({ request }) => {
    const u = await criarUsuario(request, 'm3i.nosniff');
    const { produto } = await criarProduto(request, u, { fotos: [FOTOS.png] });
    const r = await request.get(urlDoS3(produto.fotos[0].url));
    expect(r.status()).toBe(200);
    expect(r.headers()['x-content-type-options']).toBe('nosniff');
    expect(r.headers()['content-type']).toBe('image/png');
  });

  test('PUT assinado com corpo de tamanho diferente é rejeitado (script validar-content-length)', async ({ request }) => {
    test.skip(!raiz, 'infra/ não está visível neste ambiente');
    const u = await criarUsuario(request, 'm3i.cl');
    const pedir = async () => {
      const r = await request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: bearer(u.token), data: { tipo: 'image/png', tamanhoBytes: 100 } });
      expect(r.status()).toBe(200);
      return urlDoS3((await r.json()).url);
    };
    const saida = execFileSync('node', [resolve(raiz!, 'infra/s3/validar-content-length.mjs')], {
      env: { ...process.env, URL_ASSINADA: await pedir(), URL_ASSINADA_OK: await pedir(), TAMANHO: '100' },
      encoding: 'utf8',
    });
    expect(saida).toContain('REJEITADO (ok)');
    expect(saida).toContain('PUT com 100 bytes: HTTP 200');
  });

  test('CORS de produção: uma única origem https, sem localhost nem curinga', async () => {
    test.skip(!raiz, 'infra/ não está visível neste ambiente');
    const script = resolve(raiz!, 'infra/s3/aplicar-cors-producao.sh');
    const json = JSON.parse(execFileSync('sh', [script], { env: { ...process.env, ORIGEM_APP: 'https://app.keepit.com.br', DRY_RUN: '1' }, encoding: 'utf8' }));
    expect(json.CORSRules).toHaveLength(1);
    expect(json.CORSRules[0].AllowedOrigins).toEqual(['https://app.keepit.com.br']);
    expect(json.CORSRules[0].AllowedMethods).toEqual(['GET', 'PUT', 'HEAD']);
    for (const ruim of ['http://app.keepit.com.br', 'https://localhost:5173', 'https://*']) {
      expect(() => execFileSync('sh', [script], { env: { ...process.env, ORIGEM_APP: ruim, DRY_RUN: '1' }, stdio: 'pipe' }), ruim).toThrow();
    }
    // O CORS de dev continua com as origens de dev, e o de produção não herda nenhuma delas
    expect(readFileSync(resolve(raiz!, 'infra/s3/cors.prod.json'), 'utf8')).not.toMatch(/localhost|frontend:5173/);
  });

  test('ciclo de vida do bucket não expira objetos de casas/ (só multipart incompleto)', async () => {
    test.skip(!raiz, 'infra/ não está visível neste ambiente');
    const regras = JSON.parse(readFileSync(resolve(raiz!, 'infra/s3/lifecycle.json'), 'utf8')).Rules;
    for (const r of regras) expect(r.Expiration, r.ID).toBeUndefined();
  });

  test('workflow horário chama /internal/jobs e avisa sobre órfãs pendentes', async () => {
    test.skip(!raiz, '.github/ não está visível neste ambiente');
    const yml = readFileSync(resolve(raiz!, '.github/workflows/jobs.yml'), 'utf8');
    expect(yml).toContain('cron: "0 * * * *"');
    expect(yml).toContain('/internal/jobs');
    expect(yml).toContain('fotosOrfasPendentes');
  });
});
