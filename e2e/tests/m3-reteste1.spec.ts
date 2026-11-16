import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import type { APIRequestContext } from '@playwright/test';
import { API_URL, bearer, criarProduto, criarUsuario, expect, FOTOS, test, urlDoS3 } from './helpers';

// Reteste 1 do M3 (AppSec FD1, FD3, FD5, FD6, FD8, FD9, FD13): objeto imutável após confirmar, EXIF removido,
// cabeçalhos seguros na leitura, teto de envios pendentes e validação de entrada.

const nomeUnico = (p = 'Item') => `${p} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const corpo = (extra: Record<string, unknown> = {}) => ({ nome: nomeUnico('Produto'), preco: '10.00', quantidade: 1, dataCompra: '2026-01-15', ...extra });

const CRC = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(tipo: string, dados: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const td = Buffer.concat([Buffer.from(tipo), dados]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** PNG RGB válido de largura x altura (linhas de zeros comprimidas). */
function pngDe(largura: number, altura: number) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linha = Buffer.alloc(1 + largura * 3);
  const bruto = Buffer.concat(Array.from({ length: altura }, () => linha));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(bruto)), chunk('IEND', Buffer.alloc(0))]);
}

async function enviar(request: APIRequestContext, token: string, bytes: Buffer, tipo = 'image/png') {
  const r = await request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: bearer(token), data: { tipo, tamanhoBytes: bytes.length } });
  expect(r.status(), await r.text()).toBe(200);
  const ped = await r.json();
  const put = await request.put(urlDoS3(ped.url), { headers: ped.cabecalhos, data: bytes });
  expect(put.status()).toBe(200);
  return ped as { chave: string; url: string; cabecalhos: Record<string, string> };
}

test.describe('Reteste 1: fotos (defeitos 8, 9, 10 e 11)', () => {
  test('regravar pela URL de envio depois de confirmar NÃO altera a foto servida (FD1)', async ({ request }) => {
    const u = await criarUsuario(request, 'm3r.regrava');
    const bom = readFileSync(FOTOS.png.arquivo);
    const ped = await enviar(request, u.token, bom);
    const r = await request.post(`${API_URL}/produtos`, { headers: bearer(u.token), data: corpo({ fotos: [{ chave: ped.chave }] }) });
    expect(r.status(), await r.text()).toBe(201);
    const { produto } = await r.json();
    const evil = Buffer.concat([bom.subarray(0, 8), Buffer.from('<script>alert(1)</script>'.padEnd(bom.length - 8, ' '))]);
    expect(evil.length).toBe(bom.length);
    await request.put(urlDoS3(ped.url), { headers: ped.cabecalhos, data: evil }); // pode dar 200, mas não pode alcançar o objeto servido
    const det = await (await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(u.token) })).json();
    expect(det.fotos[0].chave ?? '').not.toBe(ped.chave);
    const lido = await request.get(urlDoS3(det.fotos[0].url));
    expect(lido.status()).toBe(200);
    expect((await lido.body()).includes(Buffer.from('<script>'))).toBe(false);
    // a chave de envio não vale mais como chave de foto
    const rep = await request.post(`${API_URL}/produtos`, { headers: bearer(u.token), data: corpo({ fotos: [{ chave: ped.chave }] }) });
    expect(rep.status()).toBe(422);
  });

  test('EXIF/GPS e bytes anexados são removidos; a foto servida é imagem válida (FD5, LGPD)', async ({ request }) => {
    const u = await criarUsuario(request, 'm3r.exif');
    const jpeg = readFileSync(FOTOS.jpeg.arquivo);
    const marca = Buffer.from('Exif\0\0GPS-LAT-23.5505S-LON-46.6333W-MARCA');
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(marca.length + 2) >> 8, (marca.length + 2) & 255]), marca]);
    const comExif = Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2), Buffer.from('<script>polyglot</script>')]);
    const ped = await enviar(request, u.token, comExif, 'image/jpeg');
    const r = await request.post(`${API_URL}/produtos`, { headers: bearer(u.token), data: corpo({ fotos: [{ chave: ped.chave }] }) });
    expect(r.status(), await r.text()).toBe(201);
    const { produto } = await r.json();
    const lido = await request.get(urlDoS3(produto.fotos[0].url));
    const b = await lido.body();
    expect(b.includes(Buffer.from('GPS-LAT'))).toBe(false);
    expect(b.includes(Buffer.from('<script>'))).toBe(false);
    expect(b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    expect(produto.fotos[0].tamanhoBytes).toBe(b.length);
  });

  test('arquivo corrompido e imagem acima de 8000 px por lado dão 422 ARQUIVO_INVALIDO', async ({ request }) => {
    const u = await criarUsuario(request, 'm3r.dim');
    const quebrado = Buffer.concat([readFileSync(FOTOS.png.arquivo).subarray(0, 40), Buffer.alloc(200, 7)]);
    const grande = pngDe(8001, 1);
    for (const [rotulo, bytes] of [['corrompido', quebrado], ['8001 px', grande]] as const) {
      const ped = await enviar(request, u.token, bytes);
      const r = await request.post(`${API_URL}/produtos`, { headers: bearer(u.token), data: corpo({ fotos: [{ chave: ped.chave }] }) });
      expect(r.status(), `${rotulo}: ${await r.text()}`).toBe(422);
      expect((await r.json()).error, rotulo).toBe('ARQUIVO_INVALIDO');
    }
    const ok = await enviar(request, u.token, pngDe(64, 64));
    expect((await request.post(`${API_URL}/produtos`, { headers: bearer(u.token), data: corpo({ fotos: [{ chave: ok.chave }] }) })).status()).toBe(201);
  });

  test('URL de leitura: validade <= 15 min, parâmetros response-* e cabeçalhos seguros no objeto (FD6/FD8)', async ({ request }) => {
    const u = await criarUsuario(request, 'm3r.leitura');
    const { produto } = await criarProduto(request, u, { fotos: [FOTOS.png] });
    const url = new URL(produto.fotos[0].url);
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(900);
    for (const p of ['response-content-type', 'response-content-disposition', 'response-cache-control']) expect(url.searchParams.get(p), p).toBeTruthy();
    const r = await request.get(urlDoS3(produto.fotos[0].url));
    expect(r.status()).toBe(200);
    const h = r.headers();
    expect(h['content-type']).toBe('image/png');
    expect(h['content-disposition']).toContain('inline');
    expect(h['cache-control']).toContain('private');
    // nosniff na borda (FD6): reportado no relatório quando ausente (item de infra/produção)
    test.info().annotations.push({ type: 'nosniff', description: String(h['x-content-type-options'] ?? 'ausente') });
  });

  test('teto de envios pendentes: o 11º upload-url do usuário em 2 h dá 429 MUITAS_TENTATIVAS (FD3)', async ({ request }) => {
    const u = await criarUsuario(request, 'm3r.teto');
    let primeiro429 = 0;
    for (let i = 1; i <= 12; i++) {
      const r = await request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: bearer(u.token), data: { tipo: 'image/png', tamanhoBytes: 1000 } });
      if (r.status() === 429) { primeiro429 = i; expect((await r.json()).error).toBe('MUITAS_TENTATIVAS'); break; }
      expect(r.status(), `pedido ${i}`).toBe(200);
    }
    expect(primeiro429).toBe(11);
  });

  test('o 409 PRODUTO_DUPLICADO não carrega URL assinada, só fotoCapaId', async ({ request }) => {
    const u = await criarUsuario(request, 'm3r.dup');
    const nome = nomeUnico('Dup');
    const { produto } = await criarProduto(request, u, { nome, fotos: [FOTOS.png] });
    const r = await request.post(`${API_URL}/produtos`, { headers: bearer(u.token), data: corpo({ nome }) });
    expect(r.status()).toBe(409);
    const txt = await r.text();
    expect(txt).not.toContain('X-Amz');
    expect(JSON.parse(txt).details.existente.fotoCapaId).toBe(produto.fotos[0].id);
  });
});

test.describe('Reteste 1: validação de entrada (defeito 12)', () => {
  test('preço só string, data com piso, caracteres de formato, NFC e busca com NUL', async ({ request }) => {
    const u = await criarUsuario(request, 'm3r.valida');
    const post = (extra: Record<string, unknown>) => request.post(`${API_URL}/produtos`, { headers: bearer(u.token), data: corpo(extra) });
    expect((await post({ preco: 1.5 })).status(), 'preço número').toBe(422);
    expect((await post({ dataCompra: '0001-01-01' })).status(), 'data 0001').toBe(422);
    expect((await post({ dataCompra: '1900-01-01' })).status(), 'data 1900').toBe(201);
    expect((await post({ nome: `Abc‮def ${Date.now()}` })).status(), 'U+202E').toBe(422);
    expect((await post({ nome: `Abc​def ${Date.now()}` })).status(), 'U+200B').toBe(422);
    expect((await post({ nome: `Abc\u0000def` })).status(), 'NUL no nome').toBe(422);
    const t = await request.post(`${API_URL}/tags`, { headers: bearer(u.token), data: { nome: `Tag‮ruim${Date.now()}` } });
    expect(t.status(), 'tag com U+202E').toBe(422);
    // NFC e espaços: forma decomposta e espaços repetidos caem na duplicidade
    const base = `Café  Especial ${Date.now()}`;
    expect((await post({ nome: base })).status()).toBe(201);
    const dup = await post({ nome: base.replace('é', 'é').replace('  ', ' ') });
    expect(dup.status(), 'NFD/espaço duplo deve cair na duplicidade').toBe(409);
    for (const busca of ['%00', '%01']) {
      const r = await request.get(`${API_URL}/produtos?busca=${busca}`, { headers: bearer(u.token) });
      expect(r.status(), `busca ${busca}`).toBe(422);
    }
    expect((await request.get(`${API_URL}/produtos?pagina=10001`, { headers: bearer(u.token) })).status(), 'pagina 10001').toBe(422);
    expect((await request.get(`${API_URL}/produtos?pagina=10000`, { headers: bearer(u.token) })).status(), 'pagina 10000').toBe(200);
  });
});
