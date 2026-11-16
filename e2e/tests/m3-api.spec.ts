import { readFileSync } from 'node:fs';
import type { APIRequestContext } from '@playwright/test';
import {
  API_URL, bearer, criarProduto, criarTag, criarUsuario, dispararJobs, enviarFotoPelaApi, expect, FOTOS, montarCasa, test, urlDoS3, type UsuarioE2E,
} from './helpers';
import { casaIdDoUsuario, ocuparArmazenamento, sql } from './m3-db';

// API do M3 contra o contrato docs/api/m3-produtos.md: matriz de papéis, IDOR, fotos (tipo real, tamanho, cota),
// validação, duplicidade, busca, edição, exclusão, histórico e limites.

type Quem = 'semToken' | 'LEITOR' | 'EDITOR' | 'ADMIN' | 'outraCasa';
const QUEM: Quem[] = ['semToken', 'LEITOR', 'EDITOR', 'ADMIN', 'outraCasa'];
const h = (t?: string) => (t ? bearer(t) : {});
const nomeUnico = (p = 'Item') => `${p} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

interface Cenario { admin: UsuarioE2E; editor: UsuarioE2E; leitor: UsuarioE2E; outro: UsuarioE2E; tokens: Record<Quem, string | undefined> }

async function cenario(request: APIRequestContext): Promise<Cenario> {
  const c = await montarCasa(request, { editores: 1, leitores: 1, prefixo: 'm3' });
  const outro = await criarUsuario(request, 'm3.outra');
  return {
    admin: c.admin, editor: c.editor!, leitor: c.leitor!, outro,
    tokens: { semToken: undefined, LEITOR: c.leitor!.token, EDITOR: c.editor!.token, ADMIN: c.admin.token, outraCasa: outro.token },
  };
}

/** Executa `chamar` uma vez por papel e confere o status esperado de cada linha da matriz. */
async function matriz(
  c: Cenario,
  chamar: (quem: Quem, token: string | undefined) => Promise<{ status: () => number }>,
  esperados: Record<Quem, number>,
) {
  for (const quem of QUEM) {
    const r = await chamar(quem, c.tokens[quem]);
    expect(r.status(), `papel ${quem}`).toBe(esperados[quem]);
  }
}

async function corpoErro(r: { json: () => Promise<any>; status: () => number }) {
  const j = await r.json();
  expect(typeof j.error, JSON.stringify(j)).toBe('string');
  expect(typeof j.message, JSON.stringify(j)).toBe('string');
  return j as { error: string; message: string; details?: any };
}

const novoProdutoCorpo = (extra: Record<string, unknown> = {}) => ({
  nome: nomeUnico('Produto'), preco: '10.00', quantidade: 1, dataCompra: '2026-01-15', ...extra,
});

test.describe('M3 API: matriz de papéis (RNF31)', () => {
  test('GET /tags: 401/200/200/200/200 e a outra Casa não vê as tags alheias', async ({ request }) => {
    const c = await cenario(request);
    const tag = await criarTag(request, c.admin, nomeUnico('Tag'));
    await matriz(c, (q, t) => request.get(`${API_URL}/tags`, { headers: h(t) }), { semToken: 401, LEITOR: 200, EDITOR: 200, ADMIN: 200, outraCasa: 200 });
    const outra = await (await request.get(`${API_URL}/tags`, { headers: bearer(c.outro.token) })).json();
    expect(outra.itens.map((t: any) => t.id)).not.toContain(tag.id);
    const minha = await (await request.get(`${API_URL}/tags`, { headers: bearer(c.leitor.token) })).json();
    expect(minha.itens.map((t: any) => t.id)).toContain(tag.id);
    expect(minha.itens.find((t: any) => t.id === tag.id)).toMatchObject({ nome: tag.nome, quantidadeProdutos: 0 });
  });

  test('POST /tags: 401/403/201/201/201 (a outra Casa cria na própria)', async ({ request }) => {
    const c = await cenario(request);
    await matriz(c, (q, t) => request.post(`${API_URL}/tags`, { headers: h(t), data: { nome: nomeUnico('T') } }), { semToken: 401, LEITOR: 403, EDITOR: 201, ADMIN: 201, outraCasa: 201 });
    const r = await request.post(`${API_URL}/tags`, { headers: bearer(c.leitor.token), data: { nome: 'x' } });
    expect((await corpoErro(r)).error).toBe('SEM_PERMISSAO');
  });

  test('POST /produtos/fotos/upload-url: 401/403/200/200/200', async ({ request }) => {
    const c = await cenario(request);
    await matriz(c, (q, t) => request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: h(t), data: { tipo: 'image/png', tamanhoBytes: 1000 } }), {
      semToken: 401, LEITOR: 403, EDITOR: 200, ADMIN: 200, outraCasa: 200,
    });
  });

  test('POST /produtos: 401/403/201/201/201 e o produto fica na Casa do token', async ({ request }) => {
    const c = await cenario(request);
    await matriz(c, (q, t) => request.post(`${API_URL}/produtos`, { headers: h(t), data: novoProdutoCorpo() }), { semToken: 401, LEITOR: 403, EDITOR: 201, ADMIN: 201, outraCasa: 201 });
    const doAdmin = await (await request.get(`${API_URL}/produtos?limite=100`, { headers: bearer(c.leitor.token) })).json();
    expect(doAdmin.total).toBe(2); // criados por EDITOR e ADMIN; o da outra Casa não aparece
  });

  test('GET /produtos: 401/200/200/200/200 e a outra Casa só vê os próprios', async ({ request }) => {
    const c = await cenario(request);
    const { produto } = await criarProduto(request, c.admin);
    await matriz(c, (q, t) => request.get(`${API_URL}/produtos`, { headers: h(t) }), { semToken: 401, LEITOR: 200, EDITOR: 200, ADMIN: 200, outraCasa: 200 });
    const outra = await (await request.get(`${API_URL}/produtos`, { headers: bearer(c.outro.token) })).json();
    expect(outra).toMatchObject({ itens: [], total: 0, totalPaginas: 0 });
    const lista = await (await request.get(`${API_URL}/produtos`, { headers: bearer(c.leitor.token) })).json();
    expect(lista.itens.map((p: any) => p.id)).toContain(produto.id);
  });

  test('GET /produtos/:id: 401/200/200/200/404 (IDOR)', async ({ request }) => {
    const c = await cenario(request);
    const { produto } = await criarProduto(request, c.admin);
    await matriz(c, (q, t) => request.get(`${API_URL}/produtos/${produto.id}`, { headers: h(t) }), { semToken: 401, LEITOR: 200, EDITOR: 200, ADMIN: 200, outraCasa: 404 });
    const r = await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.outro.token) });
    expect((await corpoErro(r)).error).toBe('NAO_ENCONTRADO');
  });

  test('PATCH /produtos/:id: 401/403/200/200/404 e o produto não muda nas linhas negadas', async ({ request }) => {
    const c = await cenario(request);
    const { produto } = await criarProduto(request, c.admin, { quantidade: 1 });
    const antes = produto.nome;
    for (const quem of ['semToken', 'LEITOR', 'outraCasa'] as Quem[]) {
      const r = await request.patch(`${API_URL}/produtos/${produto.id}`, { headers: h(c.tokens[quem]), data: { nome: 'Invadido' } });
      expect(r.status(), quem).toBe({ semToken: 401, LEITOR: 403, outraCasa: 404 }[quem as 'semToken']);
    }
    const lido = await (await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.admin.token) })).json();
    expect(lido.nome).toBe(antes);
    for (const quem of ['EDITOR', 'ADMIN'] as Quem[]) {
      const r = await request.patch(`${API_URL}/produtos/${produto.id}`, { headers: h(c.tokens[quem]), data: { quantidade: 5 } });
      expect(r.status(), quem).toBe(200);
    }
  });

  test('DELETE /produtos/:id: 401/403/204/204/404 e o produto sobrevive às linhas negadas', async ({ request }) => {
    const c = await cenario(request);
    const ids: Record<string, number> = {};
    for (const q of QUEM) ids[q] = (await criarProduto(request, c.admin)).produto.id;
    const esperado: Record<Quem, number> = { semToken: 401, LEITOR: 403, EDITOR: 204, ADMIN: 204, outraCasa: 404 };
    for (const q of QUEM) {
      const r = await request.delete(`${API_URL}/produtos/${ids[q]}`, { headers: h(c.tokens[q]) });
      expect(r.status(), q).toBe(esperado[q]);
    }
    for (const q of ['semToken', 'LEITOR', 'outraCasa'] as Quem[]) {
      const r = await request.get(`${API_URL}/produtos/${ids[q]}`, { headers: bearer(c.admin.token) });
      expect(r.status(), `produto de ${q} deve continuar existindo`).toBe(200);
    }
    for (const q of ['EDITOR', 'ADMIN'] as Quem[]) {
      expect((await request.get(`${API_URL}/produtos/${ids[q]}`, { headers: bearer(c.admin.token) })).status()).toBe(404);
      // segundo DELETE: 404, não 500
      expect((await request.delete(`${API_URL}/produtos/${ids[q]}`, { headers: bearer(c.admin.token) })).status()).toBe(404);
    }
  });

  test('GET /produtos/:id/historico: 401/200/200/200/404', async ({ request }) => {
    const c = await cenario(request);
    const { produto } = await criarProduto(request, c.admin);
    await matriz(c, (q, t) => request.get(`${API_URL}/produtos/${produto.id}/historico`, { headers: h(t) }), { semToken: 401, LEITOR: 200, EDITOR: 200, ADMIN: 200, outraCasa: 404 });
  });

  test('token inválido ou malformado em todas as rotas: 401 com { error, message }', async ({ request }) => {
    const rotas: [string, string][] = [
      ['GET', '/tags'], ['POST', '/tags'], ['POST', '/produtos/fotos/upload-url'], ['POST', '/produtos'], ['GET', '/produtos'],
      ['GET', '/produtos/1'], ['PATCH', '/produtos/1'], ['DELETE', '/produtos/1'], ['GET', '/produtos/1/historico'],
    ];
    for (const [m, url] of rotas) {
      const r = await request.fetch(`${API_URL}${url}`, { method: m, headers: { Authorization: 'Bearer lixo.lixo.lixo' }, data: m === 'GET' || m === 'DELETE' ? undefined : {} });
      expect(r.status(), `${m} ${url}`).toBe(401);
      expect((await corpoErro(r)).error).toMatch(/NAO_AUTENTICADO|SESSAO_EXPIRADA/);
    }
  });
});

test.describe('M3 API: IDOR com ids de produto, foto, tag e chave de outra Casa', () => {
  test('tagIds de outra Casa ou inexistente: 422 DADOS_INVALIDOS (POST e PATCH) sem revelar existência', async ({ request }) => {
    const c = await cenario(request);
    const tagAlheia = await criarTag(request, c.outro, nomeUnico('Alheia'));
    for (const id of [tagAlheia.id, 2147483000]) {
      const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ tagIds: [id] }) });
      expect(r.status()).toBe(422);
      expect((await corpoErro(r)).error).toBe('DADOS_INVALIDOS');
    }
    const { produto } = await criarProduto(request, c.admin);
    const p = await request.patch(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.admin.token), data: { tagIds: [tagAlheia.id] } });
    expect(p.status()).toBe(422);
    const lido = await (await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.admin.token) })).json();
    expect(lido.tags).toEqual([]);
  });

  test('filtro tagId de outra Casa: lista vazia, sem erro', async ({ request }) => {
    const c = await cenario(request);
    const tagAlheia = await criarTag(request, c.outro, nomeUnico('Alheia'));
    await criarProduto(request, c.admin);
    const r = await request.get(`${API_URL}/produtos?tagId=${tagAlheia.id}`, { headers: bearer(c.admin.token) });
    expect(r.status()).toBe(200);
    expect((await r.json()).itens).toEqual([]);
  });

  test('PATCH com fotos[].id de produto de outra Casa: 422 e a foto alheia permanece', async ({ request }) => {
    const c = await cenario(request);
    const alheio = (await criarProduto(request, c.outro, { fotos: [FOTOS.png] })).produto;
    const meu = (await criarProduto(request, c.admin)).produto;
    const fotoAlheia = alheio.fotos[0].id;
    const r = await request.patch(`${API_URL}/produtos/${meu.id}`, { headers: bearer(c.admin.token), data: { fotos: [{ id: fotoAlheia }] } });
    expect(r.status()).toBe(422);
    const aindaLa = await (await request.get(`${API_URL}/produtos/${alheio.id}`, { headers: bearer(c.outro.token) })).json();
    expect(aindaLa.fotos.map((f: any) => f.id)).toEqual([fotoAlheia]);
    const meuLido = await (await request.get(`${API_URL}/produtos/${meu.id}`, { headers: bearer(c.admin.token) })).json();
    expect(meuLido.fotos).toEqual([]);
  });

  test('chave de foto de outra Casa em POST: 422 ARQUIVO_INVALIDO e o objeto alheio NÃO é apagado', async ({ request }) => {
    const c = await cenario(request);
    const alheio = (await criarProduto(request, c.outro, { fotos: [FOTOS.png] })).produto;
    const chaveAlheia: string = (await sql<{ chave: string }>('select chave from foto where id = $1', [alheio.fotos[0].id]))[0].chave;
    const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ fotos: [{ chave: chaveAlheia }] }) });
    expect(r.status()).toBe(422);
    expect((await corpoErro(r)).error).toBe('ARQUIVO_INVALIDO');
    const img = await request.get(urlDoS3(alheio.fotos[0].url));
    expect(img.status(), 'o objeto da outra Casa foi apagado').toBe(200);
  });

  test('chave já gravada em outro produto da MESMA Casa: não destrói o objeto nem vira 500 (FD2 do AppSec)', async ({ request }) => {
    const c = await cenario(request);
    const a = (await criarProduto(request, c.admin, { fotos: [FOTOS.png] })).produto;
    const chave: string = (await sql<{ chave: string }>('select chave from foto where id = $1', [a.fotos[0].id]))[0].chave;
    const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.editor.token), data: novoProdutoCorpo({ fotos: [{ chave }] }) });
    expect(r.status(), await r.text()).toBeLessThan(500);
    expect(r.status()).toBe(422);
    const img = await request.get(urlDoS3(a.fotos[0].url));
    expect(img.status(), 'o objeto da foto já gravada foi apagado pelo caminho de rejeição').toBe(200);
  });

  test('chave com path traversal, prefixo de outra Casa ou formato inventado: 422', async ({ request }) => {
    const c = await cenario(request);
    const casaId = await casaIdDoUsuario(c.admin.id);
    const chaves = [
      `casas/${casaId}/fotos/../../${casaId + 1}/fotos/x.png`,
      `casas/${casaId + 1}/fotos/3f0c2b9e-6a1d-4c57-9d6e-0a8f6a2b7c11.png`,
      `casas/${casaId}/fotos/nao-e-uuid.png`,
      '../etc/passwd',
      '',
    ];
    for (const chave of chaves) {
      const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ fotos: [{ chave }] }) });
      expect(r.status(), `chave "${chave}": ${await r.text()}`).toBe(422);
    }
  });

  test('SOMAR com duplicadoId de produto de OUTRA Casa: não soma na Casa alheia', async ({ request }) => {
    const c = await cenario(request);
    const nome = nomeUnico('Cafeteira');
    const alheio = (await criarProduto(request, c.outro, { nome, quantidade: 3 })).produto;
    const meu = (await criarProduto(request, c.admin, { nome, quantidade: 2 })).produto;
    const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ nome, quantidade: 4, duplicado: 'SOMAR', duplicadoId: alheio.id }) });
    expect([200, 201, 409, 422], await r.text()).toContain(r.status());
    const lidoAlheio = await (await request.get(`${API_URL}/produtos/${alheio.id}`, { headers: bearer(c.outro.token) })).json();
    expect(lidoAlheio.quantidade, 'quantidade da outra Casa foi alterada').toBe(3);
    if (r.status() === 200) expect((await r.json()).produto.id).toBe(meu.id);
  });

  test('o histórico de um produto de outra Casa não vaza e ids fora do formato dão 422 (não 500)', async ({ request }) => {
    const c = await cenario(request);
    for (const id of ['abc', '0', '-1', '2147483648', '1.5', '99999999999999999999']) {
      for (const [m, rota] of [['GET', `/produtos/${id}`], ['PATCH', `/produtos/${id}`], ['DELETE', `/produtos/${id}`], ['GET', `/produtos/${id}/historico`]]) {
        const r = await request.fetch(`${API_URL}${rota}`, { method: m, headers: bearer(c.admin.token), data: m === 'PATCH' ? { nome: 'x' } : undefined });
        expect(r.status(), `${m} ${rota}`).toBe(422);
      }
    }
  });
});

test.describe('M3 API: validação do cadastro (seção 1 do contrato)', () => {
  test('campos inválidos dão 422 DADOS_INVALIDOS com details por campo', async ({ request }) => {
    const c = await cenario(request);
    const casos: [string, Record<string, unknown>, string][] = [
      ['nome vazio', { nome: '   ' }, 'nome'],
      ['nome com 121 caracteres', { nome: 'a'.repeat(121) }, 'nome'],
      ['nome com <', { nome: 'Cabo <script>alert(1)</script>' }, 'nome'],
      ['nome com caractere de controle', { nome: 'ab\u0000cd' }, 'nome'],
      ['descrição com 1001', { descricao: 'd'.repeat(1001) }, 'descricao'],
      ['preço texto', { preco: 'abc' }, 'preco'],
      ['preço negativo', { preco: '-1.00' }, 'preco'],
      ['preço com 3 casas', { preco: '1.234' }, 'preco'],
      ['preço com vírgula', { preco: '1,50' }, 'preco'],
      ['preço acima do máximo', { preco: '10000000000.00' }, 'preco'],
      ['quantidade 0', { quantidade: 0 }, 'quantidade'],
      ['quantidade 1000001', { quantidade: 1_000_001 }, 'quantidade'],
      ['quantidade fracionada', { quantidade: 1.5 }, 'quantidade'],
      ['quantidade texto', { quantidade: 'dois' }, 'quantidade'],
      ['data futura', { dataCompra: '2999-01-01' }, 'dataCompra'],
      ['data inexistente', { dataCompra: '2026-02-30' }, 'dataCompra'],
      ['data em outro formato', { dataCompra: '15/01/2026' }, 'dataCompra'],
      ['11 tags', { tagIds: Array.from({ length: 11 }, (_, i) => i + 1) }, 'tagIds'],
      ['tagIds repetidos', { tagIds: [1, 1] }, 'tagIds'],
      ['duplicado inválido', { duplicado: 'TALVEZ' }, 'duplicado'],
      ['SOMAR sem duplicadoId', { duplicado: 'SOMAR' }, 'duplicadoId'],
    ];
    for (const [rotulo, extra, campo] of casos) {
      const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo(extra) });
      expect(r.status(), `${rotulo}: ${await r.text()}`).toBe(422);
      const j = await corpoErro(r);
      expect(j.error, rotulo).toBe('DADOS_INVALIDOS');
      expect(JSON.stringify(j.details), `${rotulo} deveria citar "${campo}"`).toContain(campo);
    }
  });

  test('campos obrigatórios ausentes e corpo vazio: 422', async ({ request }) => {
    const c = await cenario(request);
    for (const faltando of ['nome', 'preco', 'quantidade', 'dataCompra']) {
      const corpo: Record<string, unknown> = novoProdutoCorpo();
      delete corpo[faltando];
      const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: corpo });
      expect(r.status(), faltando).toBe(422);
    }
    expect((await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: {} })).status()).toBe(422);
  });

  test('limites aceitos: nome 120, descrição 1000, quantidade 1.000.000, preço máximo e zero, 10 tags', async ({ request }) => {
    const c = await cenario(request);
    const tags = [];
    for (let i = 0; i < 10; i++) tags.push((await criarTag(request, c.admin, nomeUnico(`L${i}`))).id);
    const r = await request.post(`${API_URL}/produtos`, {
      headers: bearer(c.admin.token),
      data: novoProdutoCorpo({ nome: 'n'.repeat(120), descricao: 'd'.repeat(1000), quantidade: 1_000_000, preco: '9999999999.99', tagIds: tags }),
    });
    expect(r.status(), await r.text()).toBe(201);
    const { produto } = await r.json();
    expect(produto.preco).toBe('9999999999.99');
    expect(produto.tags).toHaveLength(10);
    const zero = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ preco: '0' }) });
    expect(zero.status(), await zero.text()).toBe(201);
    expect((await zero.json()).produto.preco).toBe('0.00');
  });

  test('preço sempre volta como string decimal; número JSON é recusado (422); campos casaId/adicionadoPorId do corpo são ignorados', async ({ request }) => {
    const c = await cenario(request);
    const outraCasaId = await casaIdDoUsuario(c.outro.id);
    const r0 = await request.post(`${API_URL}/produtos`, {
      headers: bearer(c.admin.token),
      data: novoProdutoCorpo({ preco: 1234.5 }),
    });
    expect(r0.status()).toBe(422);
    const r = await request.post(`${API_URL}/produtos`, {
      headers: bearer(c.admin.token),
      data: novoProdutoCorpo({ preco: '1234.5', casaId: outraCasaId, adicionadoPorId: c.outro.id, dataCadastro: '2000-01-01T00:00:00Z' }),
    });
    expect(r.status(), await r.text()).toBe(201);
    const { produto } = await r.json();
    expect(produto.preco).toBe('1234.50');
    expect(produto.adicionadoPor.id).toBe(c.admin.id);
    expect(new Date(produto.dataCadastro).getFullYear()).toBeGreaterThanOrEqual(2026);
    expect((await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.outro.token) })).status()).toBe(404);
  });

  test('XSS: nome e descrição com < ou > são recusados; texto legítimo com acentos e quebra de linha é aceito', async ({ request }) => {
    const c = await cenario(request);
    expect((await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ descricao: '<img src=x onerror=alert(1)>' }) })).status()).toBe(422);
    const ok = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ nome: nomeUnico('Cafeteira Elétrica Ação'), descricao: 'linha 1\nlinha 2' }) });
    expect(ok.status(), await ok.text()).toBe(201);
    expect((await ok.json()).produto.descricao).toBe('linha 1\nlinha 2');
  });

  test('respostas com URL assinada saem com Cache-Control: no-store', async ({ request }) => {
    const c = await cenario(request);
    const { produto } = await criarProduto(request, c.admin, { fotos: [FOTOS.png] });
    for (const rota of [`/produtos/${produto.id}`, '/produtos']) {
      const r = await request.get(`${API_URL}${rota}`, { headers: bearer(c.admin.token) });
      expect(r.headers()['cache-control'], rota).toContain('no-store');
    }
  });
});

test.describe('M3 API: tags (RF35)', () => {
  test('TAG_EXISTENTE sem diferenciar caixa e com details.existente; validação de tamanho', async ({ request }) => {
    const c = await cenario(request);
    const nome = nomeUnico('Cozinha');
    const t = await criarTag(request, c.admin, nome);
    for (const variante of [nome.toLowerCase(), nome.toUpperCase(), `  ${nome}  `]) {
      const r = await request.post(`${API_URL}/tags`, { headers: bearer(c.editor.token), data: { nome: variante } });
      expect(r.status(), variante).toBe(409);
      const j = await corpoErro(r);
      expect(j.error).toBe('TAG_EXISTENTE');
      expect(j.details.existente).toEqual({ id: t.id, nome });
    }
    // a mesma tag pode existir em outra Casa
    const outra = await request.post(`${API_URL}/tags`, { headers: bearer(c.outro.token), data: { nome } });
    expect(outra.status()).toBe(201);
    for (const invalido of ['', '   ', 'a'.repeat(41), '<b>', 'x\u0000y']) {
      const r = await request.post(`${API_URL}/tags`, { headers: bearer(c.admin.token), data: { nome: invalido } });
      expect(r.status(), JSON.stringify(invalido)).toBe(422);
    }
    expect((await request.post(`${API_URL}/tags`, { headers: bearer(c.admin.token), data: { nome: 'a'.repeat(40) } })).status()).toBe(201);
    const ok = await request.post(`${API_URL}/tags`, { headers: bearer(c.admin.token), data: { nome: '  Garantia  ' } });
    expect((await ok.json()).nome).toBe('Garantia');
  });

  test('criação simultânea da mesma tag: uma 201 e as demais 409 (nunca 500)', async ({ request }) => {
    const c = await cenario(request);
    const nome = nomeUnico('Corrida');
    const rs = await Promise.all(Array.from({ length: 6 }, () => request.post(`${API_URL}/tags`, { headers: bearer(c.admin.token), data: { nome } })));
    const status = rs.map((r) => r.status()).sort();
    expect(status.filter((s) => s === 201)).toHaveLength(1);
    expect(status.filter((s) => s === 409)).toHaveLength(5);
  });

  test('GET /tags traz quantidadeProdutos e ordena sem diferenciar caixa', async ({ request }) => {
    const c = await cenario(request);
    const b = await criarTag(request, c.admin, 'banana');
    const a = await criarTag(request, c.admin, 'Abacaxi');
    const z = await criarTag(request, c.admin, 'Zebra');
    await criarProduto(request, c.admin, { tagIds: [b.id, a.id] });
    await criarProduto(request, c.admin, { tagIds: [b.id] });
    const { itens } = await (await request.get(`${API_URL}/tags`, { headers: bearer(c.admin.token) })).json();
    expect(itens.map((t: any) => t.nome)).toEqual(['Abacaxi', 'banana', 'Zebra']);
    expect(itens.map((t: any) => t.quantidadeProdutos)).toEqual([1, 2, 0]);
    expect(z.id).toBeGreaterThan(0);
  });
});

test.describe('M3 API: duplicidade (RF33)', () => {
  test('409 PRODUTO_DUPLICADO por lower(trim(nome)) com existente, quantidadeInformada e opcoes; nada é gravado', async ({ request }) => {
    const c = await cenario(request);
    const nome = nomeUnico('Cafeteira Elétrica');
    const { produto: a } = await criarProduto(request, c.admin, { nome, quantidade: 2, preco: '199.00', fotos: [FOTOS.png] });
    const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.editor.token), data: novoProdutoCorpo({ nome: `  ${nome.toUpperCase()}  `, quantidade: 3 }) });
    expect(r.status()).toBe(409);
    const j = await corpoErro(r);
    expect(j.error).toBe('PRODUTO_DUPLICADO');
    expect(j.details.existente).toMatchObject({ id: a.id, nome, preco: '199.00', quantidade: 2, dataCompra: '2026-01-15' });
    expect(j.details.existente.fotoCapaId).toEqual(expect.any(Number));
    expect(JSON.stringify(j)).not.toContain('X-Amz-Signature');
    expect(j.details.quantidadeInformada).toBe(3);
    expect(j.details.opcoes).toEqual(['SOMAR', 'CADASTRAR_MESMO_ASSIM', 'CANCELAR']);
    const lista = await (await request.get(`${API_URL}/produtos?busca=${encodeURIComponent(nome)}`, { headers: bearer(c.admin.token) })).json();
    expect(lista.total).toBe(1);
  });

  test('acentos diferentes NÃO são duplicado (decisão do PO); outra Casa com o mesmo nome também não', async ({ request }) => {
    const c = await cenario(request);
    const base = nomeUnico('Cafe');
    await criarProduto(request, c.admin, { nome: `${base} Elétrica` });
    expect((await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ nome: `${base} Eletrica` }) })).status()).toBe(201);
    expect((await request.post(`${API_URL}/produtos`, { headers: bearer(c.outro.token), data: novoProdutoCorpo({ nome: `${base} Elétrica` }) })).status()).toBe(201);
  });

  test('SOMAR: 200 QUANTIDADE_SOMADA soma só a quantidade e mantém os demais dados; gera evento no histórico', async ({ request }) => {
    const c = await cenario(request);
    const nome = nomeUnico('Panela');
    const { produto: a } = await criarProduto(request, c.admin, { nome, quantidade: 2, preco: '50.00', descricao: 'original' });
    const r = await request.post(`${API_URL}/produtos`, {
      headers: bearer(c.editor.token),
      data: novoProdutoCorpo({ nome, quantidade: 3, preco: '999.00', descricao: 'descartada', duplicado: 'SOMAR', duplicadoId: a.id }),
    });
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    expect(j.resultado).toBe('QUANTIDADE_SOMADA');
    expect(j.produto).toMatchObject({ id: a.id, quantidade: 5, preco: '50.00', descricao: 'original' });
    const h = await (await request.get(`${API_URL}/produtos/${a.id}/historico`, { headers: bearer(c.admin.token) })).json();
    expect(h.itens[0]).toMatchObject({ tipo: 'QUANTIDADE_SOMADA', detalhes: { anterior: 2, somada: 3, final: 5 } });
    expect(h.itens[0].autor).toEqual({ nome: c.editor.nome });
    expect(h.itens[1].tipo).toBe('CRIADO');
  });

  test('SOMAR acima de 1.000.000: 422 em quantidade e nada muda', async ({ request }) => {
    const c = await cenario(request);
    const nome = nomeUnico('Parafuso');
    const { produto: a } = await criarProduto(request, c.admin, { nome, quantidade: 999_999 });
    const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ nome, quantidade: 5, duplicado: 'SOMAR', duplicadoId: a.id }) });
    expect(r.status()).toBe(422);
    expect(JSON.stringify((await r.json()).details)).toContain('quantidade');
    expect((await (await request.get(`${API_URL}/produtos/${a.id}`, { headers: bearer(c.admin.token) })).json()).quantidade).toBe(999_999);
  });

  test('CADASTRAR_MESMO_ASSIM cria o segundo; depois o 409 mostra o MAIS ANTIGO', async ({ request }) => {
    const c = await cenario(request);
    const nome = nomeUnico('Caneca');
    const { produto: a } = await criarProduto(request, c.admin, { nome });
    const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ nome, duplicado: 'CADASTRAR_MESMO_ASSIM' }) });
    expect(r.status(), await r.text()).toBe(201);
    const b = (await r.json()).produto;
    expect(b.id).not.toBe(a.id);
    const outra = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ nome }) });
    expect(outra.status()).toBe(409);
    expect((await outra.json()).details.existente.id).toBe(a.id);
  });

  test('SOMAR com duplicadoId que não é o duplicado atual: 409 de novo com o existente atual; duplicado sumido: 201 CRIADO', async ({ request }) => {
    const c = await cenario(request);
    const nome = nomeUnico('Jarra');
    const { produto: a } = await criarProduto(request, c.admin, { nome });
    const outroProduto = (await criarProduto(request, c.admin)).produto;
    const errado = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ nome, duplicado: 'SOMAR', duplicadoId: outroProduto.id }) });
    expect(errado.status()).toBe(409);
    expect((await errado.json()).details.existente.id).toBe(a.id);
    expect((await request.delete(`${API_URL}/produtos/${a.id}`, { headers: bearer(c.admin.token) })).status()).toBe(204);
    const sumido = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ nome, duplicado: 'SOMAR', duplicadoId: a.id }) });
    expect(sumido.status(), await sumido.text()).toBe(201);
    expect((await sumido.json()).resultado).toBe('CRIADO');
  });

  test('cadastros simultâneos do mesmo nome com SOMAR não perdem quantidade (atomicidade)', async ({ request }) => {
    const c = await cenario(request);
    const nome = nomeUnico('Colher');
    const { produto: a } = await criarProduto(request, c.admin, { nome, quantidade: 1 });
    const rs = await Promise.all(Array.from({ length: 8 }, () => request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ nome, quantidade: 1, duplicado: 'SOMAR', duplicadoId: a.id }) })));
    for (const r of rs) expect(r.status(), await r.text()).toBe(200);
    expect((await (await request.get(`${API_URL}/produtos/${a.id}`, { headers: bearer(c.admin.token) })).json()).quantidade).toBe(9);
  });

  test('editar o nome para um já existente NÃO bloqueia (decisão do PO)', async ({ request }) => {
    const c = await cenario(request);
    const nome = nomeUnico('Faca');
    await criarProduto(request, c.admin, { nome });
    const { produto: b } = await criarProduto(request, c.admin);
    const r = await request.patch(`${API_URL}/produtos/${b.id}`, { headers: bearer(c.admin.token), data: { nome } });
    expect(r.status(), await r.text()).toBe(200);
  });
});

test.describe('M3 API: listagem, busca e filtro (RF10, RF34)', () => {
  test('busca contém, sem diferenciar caixa; %, _ e \\ são literais; tagId; ordem; paginação', async ({ request }) => {
    const c = await cenario(request);
    const marca = `zq${Date.now()}`;
    const tag = await criarTag(request, c.admin, nomeUnico('Filtro'));
    const nomes = [`${marca} Alfa`, `${marca} bravo`, `${marca} 100% algodão`, `${marca} a_b`, `${marca} c\\d`];
    const ids: number[] = [];
    for (const n of nomes) ids.push((await criarProduto(request, c.admin, { nome: n, tagIds: n.endsWith('Alfa') ? [tag.id] : [] })).produto.id);
    const get = async (qs: string) => (await request.get(`${API_URL}/produtos?${qs}`, { headers: bearer(c.leitor.token) })).json();

    expect((await get(`busca=${marca.toUpperCase()}`)).total).toBe(5);
    expect((await get(`busca=${marca}%20ALFA`)).itens.map((p: any) => p.id)).toEqual([ids[0]]);
    expect((await get(`busca=${encodeURIComponent('%')}`)).total).toBe(1); // só o "100%"
    expect((await get(`busca=${encodeURIComponent('_')}`)).total).toBe(1); // só o "a_b"
    expect((await get(`busca=${encodeURIComponent('\\')}`)).total).toBe(1);
    expect((await get(`busca=${marca}&tagId=${tag.id}`)).itens.map((p: any) => p.id)).toEqual([ids[0]]);
    expect((await get(`busca=nao-existe-${marca}`))).toMatchObject({ itens: [], total: 0, totalPaginas: 0 });

    const porNome = await get(`busca=${marca}&ordem=nome`);
    expect(porNome.itens.map((p: any) => p.nome.toLowerCase())).toEqual([...porNome.itens.map((p: any) => p.nome.toLowerCase())].sort());
    const recentes = await get(`busca=${marca}`);
    expect(recentes.itens.map((p: any) => p.id)).toEqual([...ids].reverse());

    const p1 = await get(`busca=${marca}&limite=2&pagina=1`);
    expect(p1).toMatchObject({ pagina: 1, limite: 2, total: 5, totalPaginas: 3 });
    expect(p1.itens).toHaveLength(2);
    expect((await get(`busca=${marca}&limite=2&pagina=3`)).itens).toHaveLength(1);
    expect((await get(`busca=${marca}&limite=2&pagina=9`))).toMatchObject({ itens: [], total: 5 });
    const padrao = await get('');
    expect(padrao.limite).toBe(20);
    expect((await get('limite=5')).itens.length).toBeLessThanOrEqual(5);
  });

  test('parâmetros inválidos: 422 (limite 0/101, pagina 0/-1/texto, ordem desconhecida, tagId texto, busca > 120)', async ({ request }) => {
    const c = await cenario(request);
    for (const qs of ['limite=0', 'limite=101', 'pagina=0', 'pagina=-1', 'pagina=abc', 'ordem=preco', 'tagId=abc', `busca=${'a'.repeat(121)}`]) {
      const r = await request.get(`${API_URL}/produtos?${qs}`, { headers: bearer(c.admin.token) });
      expect(r.status(), qs).toBe(422);
    }
  });

  test('pagina gigantesca não derruba a API (sem 500)', async ({ request }) => {
    const c = await cenario(request);
    for (const pagina of ['2147483647', '99999999999', '4294967296']) {
      const r = await request.get(`${API_URL}/produtos?pagina=${pagina}`, { headers: bearer(c.admin.token) });
      expect(r.status(), `pagina=${pagina}: ${await r.text()}`).toBeLessThan(500);
    }
    const h = await request.get(`${API_URL}/produtos/1/historico?pagina=99999999999`, { headers: bearer(c.admin.token) });
    expect(h.status()).toBeLessThan(500);
  });

  test('item da lista traz tags em ordem alfabética, fotoCapa assinada, adicionadoPor e preço string', async ({ request }) => {
    const c = await cenario(request);
    const tz = await criarTag(request, c.admin, 'zeta');
    const ta = await criarTag(request, c.admin, 'Alfa');
    const { produto } = await criarProduto(request, c.editor, { tagIds: [tz.id, ta.id], fotos: [FOTOS.jpeg, FOTOS.png] });
    const lista = await (await request.get(`${API_URL}/produtos`, { headers: bearer(c.leitor.token) })).json();
    const item = lista.itens.find((p: any) => p.id === produto.id);
    expect(item.tags.map((t: any) => t.nome)).toEqual(['Alfa', 'zeta']);
    expect(item.fotoCapa.url).toContain('X-Amz-Signature');
    expect(typeof item.preco).toBe('string');
    expect(item.adicionadoPor).toEqual({ id: c.editor.id, nome: c.editor.nome });
    expect(item).not.toHaveProperty('fotos');
    const img = await request.get(urlDoS3(item.fotoCapa.url));
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toContain('image/jpeg');
  });
});

test.describe('M3 API: fotos (RF05, RNF08, RNF09, RF39)', () => {
  test('upload-url: tipo fora de JPEG/PNG, tamanho 0, negativo e > 5 MB dão 422 ARQUIVO_INVALIDO; 5 MB exatos passam', async ({ request }) => {
    const c = await cenario(request);
    const casos: [string, any][] = [
      ['gif', { tipo: 'image/gif', tamanhoBytes: 1000 }],
      ['svg', { tipo: 'image/svg+xml', tamanhoBytes: 1000 }],
      ['pdf', { tipo: 'application/pdf', tamanhoBytes: 1000 }],
      ['tamanho 0', { tipo: 'image/png', tamanhoBytes: 0 }],
      ['tamanho negativo', { tipo: 'image/png', tamanhoBytes: -5 }],
      ['5 MB + 1', { tipo: 'image/png', tamanhoBytes: 5_242_881 }],
    ];
    for (const [rotulo, data] of casos) {
      const r = await request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: bearer(c.admin.token), data });
      expect(r.status(), `${rotulo}: ${await r.text()}`).toBe(422);
      expect((await corpoErro(r)).error, rotulo).toBe('ARQUIVO_INVALIDO');
    }
    for (const data of [{}, { tipo: 'image/png' }, { tamanhoBytes: 10 }, { tipo: 5, tamanhoBytes: 'x' }, { tipo: 'image/png', tamanhoBytes: 1.5 }]) {
      const r = await request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: bearer(c.admin.token), data });
      expect(r.status(), JSON.stringify(data)).toBe(422);
    }
    const ok = await request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: bearer(c.admin.token), data: { tipo: 'image/png', tamanhoBytes: 5_242_880 } });
    expect(ok.status(), await ok.text()).toBe(200);
    const j = await ok.json();
    const casaId = await casaIdDoUsuario(c.admin.id);
    expect(j.chave).toMatch(new RegExp(`^casas/${casaId}/pendentes/[0-9a-f-]{36}\\.png$`));
    expect(j.metodo).toBe('PUT');
    expect(j.cabecalhos).toEqual({ 'Content-Type': 'image/png' });
    const dur = new Date(j.expiraEm).getTime() - Date.now();
    expect(dur).toBeGreaterThan(3 * 60_000);
    expect(dur).toBeLessThanOrEqual(5 * 60_000 + 5_000);
    const conf = new Date(j.confirmarAte).getTime() - Date.now();
    expect(conf).toBeGreaterThan(100 * 60_000);
    expect(conf).toBeLessThanOrEqual(120 * 60_000 + 5_000);
    expect(j.chave).not.toContain('..');
  });

  test('o S3 recusa PUT com tamanho ou tipo diferentes do assinado e GET sem assinatura', async ({ request }) => {
    const c = await cenario(request);
    const corpo = readFileSync(FOTOS.png.arquivo);
    const ped = await (await request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: bearer(c.admin.token), data: { tipo: 'image/png', tamanhoBytes: corpo.length } })).json();
    const maior = await request.put(urlDoS3(ped.url), { headers: ped.cabecalhos, data: Buffer.concat([corpo, Buffer.alloc(100)]) });
    expect(maior.status(), 'PUT com tamanho maior que o assinado').toBe(403);
    const tipo = await request.put(urlDoS3(ped.url), { headers: { 'Content-Type': 'image/jpeg' }, data: corpo });
    expect(tipo.status(), 'PUT com Content-Type diferente').toBe(403);
    const semAssinatura = await request.get(urlDoS3(ped.url.split('?')[0]));
    expect(semAssinatura.status()).toBe(403);
    const certo = await request.put(urlDoS3(ped.url), { headers: ped.cabecalhos, data: corpo });
    expect(certo.status()).toBe(200);
  });

  test('confirmação: chave nunca enviada ao S3 → 422 ARQUIVO_INVALIDO com details fotos.0', async ({ request }) => {
    const c = await cenario(request);
    const ped = await (await request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: bearer(c.admin.token), data: { tipo: 'image/png', tamanhoBytes: 500 } })).json();
    const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ fotos: [{ chave: ped.chave }] }) });
    expect(r.status(), await r.text()).toBe(422);
    const j = await corpoErro(r);
    expect(j.error).toBe('ARQUIVO_INVALIDO');
    expect(JSON.stringify(j.details)).toContain('fotos.0');
    const lista = await (await request.get(`${API_URL}/produtos?busca=${encodeURIComponent('Produto')}`, { headers: bearer(c.admin.token) })).json();
    expect(lista.total).toBe(0); // nada foi gravado
  });

  test('confirmação: bytes de texto declarados como PNG/JPEG → 422, nada gravado e objeto removido do S3', async ({ request }) => {
    const c = await cenario(request);
    const texto = readFileSync(FOTOS.texto.arquivo);
    for (const mime of ['image/jpeg', 'image/png']) {
      const ped = await (await request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: bearer(c.admin.token), data: { tipo: mime, tamanhoBytes: texto.length } })).json();
      expect((await request.put(urlDoS3(ped.url), { headers: ped.cabecalhos, data: texto })).status()).toBe(200);
      const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ fotos: [{ chave: ped.chave }] }) });
      expect(r.status(), `${mime}: ${await r.text()}`).toBe(422);
      expect((await corpoErro(r)).error).toBe('ARQUIVO_INVALIDO');
    }
    expect((await sql('select 1 from produto where casa_id = $1', [await casaIdDoUsuario(c.admin.id)])).length).toBe(0);
  });

  test('confirmação: tipo real diferente do declarado (JPEG declarado como PNG e vice-versa) é recusado', async ({ request }) => {
    const c = await cenario(request);
    const jpeg = readFileSync(FOTOS.jpeg.arquivo);
    const png = readFileSync(FOTOS.png.arquivo);
    const pares: [string, Buffer][] = [['image/png', jpeg], ['image/jpeg', png]];
    for (const [declarado, bytes] of pares) {
      const ped = await (await request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: bearer(c.admin.token), data: { tipo: declarado, tamanhoBytes: bytes.length } })).json();
      expect((await request.put(urlDoS3(ped.url), { headers: ped.cabecalhos, data: bytes })).status()).toBe(200);
      const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ fotos: [{ chave: ped.chave }] }) });
      expect(r.status(), `declarado ${declarado}: ${await r.text()}`).toBe(422);
    }
  });

  test('PNG com extensão .jpg (declarado como PNG) é aceito pelo tipo real e gravado como PNG', async ({ request }) => {
    const c = await cenario(request);
    const { produto } = await criarProduto(request, c.admin, { fotos: [FOTOS.pngRenomeado] });
    expect(produto.fotos[0].tipo).toBe('PNG');
  });

  test('LIMITE_FOTOS: 4 fotos em POST e em PATCH dão 422 e nada muda', async ({ request }) => {
    const c = await cenario(request);
    const chaves = [];
    for (let i = 0; i < 4; i++) chaves.push({ chave: (await enviarFotoPelaApi(request, c.admin, FOTOS.png)).chave });
    const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ fotos: chaves }) });
    expect(r.status(), await r.text()).toBe(422);
    expect((await corpoErro(r)).error).toBe('LIMITE_FOTOS');
    const { produto } = await criarProduto(request, c.admin, { fotos: [FOTOS.png, FOTOS.jpeg, FOTOS.png] });
    expect(produto.fotos).toHaveLength(3);
    const extra = await enviarFotoPelaApi(request, c.admin, FOTOS.png);
    const p = await request.patch(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.admin.token), data: { fotos: [...produto.fotos.map((f: any) => ({ id: f.id })), { chave: extra.chave }] } });
    expect(p.status(), await p.text()).toBe(422);
    expect((await corpoErro(p)).error).toBe('LIMITE_FOTOS');
    const lido = await (await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.admin.token) })).json();
    expect(lido.fotos).toHaveLength(3);
  });

  test('fotos[] com a mesma chave repetida: sem 500', async ({ request }) => {
    const c = await cenario(request);
    const { chave } = await enviarFotoPelaApi(request, c.admin, FOTOS.png);
    const r = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ fotos: [{ chave }, { chave }] }) });
    expect(r.status(), await r.text()).toBeLessThan(500);
  });

  test('COTA_EXCEDIDA é 409 com details { plano, usadoBytes, limiteBytes } em upload-url, POST e PATCH (plano Individual, 1 GB)', async ({ request }) => {
    const u = await criarUsuario(request, 'm3.cota'); // Casa Individual: 1 GB = 1.073.741.824 bytes
    const { produto: base } = await criarProduto(request, u);
    const outro = (await criarProduto(request, u)).produto;
    // Deixa só 100 bytes livres: qualquer foto real estoura. Foto "fantasma" só no banco (sem objeto no S3).
    await ocuparArmazenamento(base.id, 1_073_741_724);

    const url = await request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: bearer(u.token), data: { tipo: 'image/png', tamanhoBytes: 5_242_880 } });
    expect(url.status(), await url.text()).toBe(409);
    const j = await corpoErro(url);
    expect(j.error).toBe('COTA_EXCEDIDA');
    expect(j.details).toMatchObject({ plano: 'INDIVIDUAL', usadoBytes: 1_073_741_724, limiteBytes: 1_073_741_824 });

    // upload-url é só aviso antecipado: com 50 bytes ainda cabe; a API é a autoridade ao salvar
    const ped = await request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: bearer(u.token), data: { tipo: 'image/png', tamanhoBytes: 50 } });
    expect(ped.status()).toBe(200);
  });

  test('COTA_EXCEDIDA ao SALVAR (a cota encheu entre o envio e o salvar) em POST e PATCH: 409 e nada é gravado', async ({ request }) => {
    const u = await criarUsuario(request, 'm3.cota2');
    const { produto: base } = await criarProduto(request, u);
    const outro = (await criarProduto(request, u)).produto;
    const paraPost = await enviarFotoPelaApi(request, u, FOTOS.png);
    const paraPatch = await enviarFotoPelaApi(request, u, FOTOS.jpeg);
    await ocuparArmazenamento(base.id, 1_073_741_724); // outra pessoa encheu a cota nesse meio tempo
    const post = await request.post(`${API_URL}/produtos`, { headers: bearer(u.token), data: novoProdutoCorpo({ nome: 'Estoura cota', fotos: [{ chave: paraPost.chave }] }) });
    expect(post.status(), await post.text()).toBe(409);
    expect((await corpoErro(post)).error).toBe('COTA_EXCEDIDA');
    expect((await sql('select 1 from produto where nome = $1 and casa_id = $2', ['Estoura cota', await casaIdDoUsuario(u.id)])).length, 'produto gravado apesar da cota').toBe(0);
    const patch = await request.patch(`${API_URL}/produtos/${outro.id}`, { headers: bearer(u.token), data: { fotos: [{ chave: paraPatch.chave }] } });
    expect(patch.status(), await patch.text()).toBe(409);
    expect((await corpoErro(patch)).error).toBe('COTA_EXCEDIDA');
    expect((await (await request.get(`${API_URL}/produtos/${outro.id}`, { headers: bearer(u.token) })).json()).fotos).toEqual([]);
  });

  test('cota na edição usa o saldo líquido: trocar a foto por outra de tamanho igual passa mesmo com a cota cheia', async ({ request }) => {
    const u = await criarUsuario(request, 'm3.liquido');
    const { produto } = await criarProduto(request, u, { fotos: [FOTOS.png] });
    const tam = produto.fotos[0].tamanhoBytes as number;
    const outro = (await criarProduto(request, u)).produto;
    const nova = await enviarFotoPelaApi(request, u, FOTOS.png);
    await ocuparArmazenamento(outro.id, 1_073_741_824 - tam); // usado = limite exato; trocar tam por tam tem saldo 0
    const r = await request.patch(`${API_URL}/produtos/${produto.id}`, { headers: bearer(u.token), data: { fotos: [{ chave: nova.chave }] } });
    expect(r.status(), await r.text()).toBe(200);
  });

  test('cota é da Casa: a foto do EDITOR e do ADMIN somam; excluir o produto libera o espaço', async ({ request }) => {
    const c = await cenario(request);
    const { produto } = await criarProduto(request, c.editor, { fotos: [FOTOS.png] });
    const tam = produto.fotos[0].tamanhoBytes as number;
    const soma = async () => Number((await sql<{ s: string }>('select coalesce(sum(f.tamanho_bytes),0) s from foto f join produto p on p.id=f.produto_id where p.casa_id=$1', [await casaIdDoUsuario(c.admin.id)]))[0].s);
    expect(await soma()).toBe(tam);
    expect((await request.delete(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.admin.token) })).status()).toBe(204);
    expect(await soma()).toBe(0);
  });

  test('GET /me traz uso.armazenamento { usadoBytes, limiteBytes } (contrato, seção 1)', async ({ request }) => {
    const c = await cenario(request);
    await criarProduto(request, c.admin, { fotos: [FOTOS.png] });
    const me = await (await request.get(`${API_URL}/me`, { headers: bearer(c.admin.token) })).json();
    expect(me.uso?.armazenamento, `GET /me sem uso.armazenamento: ${JSON.stringify(Object.keys(me))}`).toMatchObject({ limiteBytes: expect.any(Number) });
    const ass = await (await request.get(`${API_URL}/assinaturas/atual`, { headers: bearer(c.admin.token) })).json();
    expect(me.uso.armazenamento.limiteBytes).toBe(ass.uso.armazenamento.limiteBytes);
    expect(me.uso.armazenamento.usadoBytes).toBeGreaterThan(0);
  });

});

test.describe('M3 API: edição, histórico e exclusão (RF04, RF09, RF11)', () => {
  test('PATCH parcial: campo omitido não muda; descricao null limpa; tagIds substitui; corpo sem campos conhecidos dá 422', async ({ request }) => {
    const c = await cenario(request);
    const t1 = await criarTag(request, c.admin, nomeUnico('A'));
    const t2 = await criarTag(request, c.admin, nomeUnico('B'));
    const { produto } = await criarProduto(request, c.admin, { descricao: 'desc', tagIds: [t1.id], preco: '12.30', quantidade: 4 });
    const patch = (data: any) => request.patch(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.editor.token), data });
    const r1 = await patch({ preco: '15.00' });
    expect(r1.status()).toBe(200);
    expect(await r1.json()).toMatchObject({ preco: '15.00', quantidade: 4, descricao: 'desc', tags: [{ id: t1.id }] });
    const r2 = await patch({ descricao: null, tagIds: [t2.id] });
    expect(await r2.json()).toMatchObject({ descricao: null, tags: [{ id: t2.id }] });
    const r3 = await patch({ tagIds: [] });
    expect((await r3.json()).tags).toEqual([]);
    expect((await patch({})).status()).toBe(422);
    expect((await patch({ casaId: 1 })).status()).toBe(422);
    expect((await patch({ quantidade: 0 })).status()).toBe(422);
    expect((await patch({ nome: '' })).status()).toBe(422);
  });

  test('histórico: CRIADO, ALTERADO com antes/depois por campo, sem evento quando nada muda, ordem mais novo primeiro', async ({ request }) => {
    const c = await cenario(request);
    const tag = await criarTag(request, c.admin, 'Garantia');
    const { produto } = await criarProduto(request, c.admin, { nome: nomeUnico('Hist'), quantidade: 1, preco: '10.00', tagIds: [] });
    const patch = (data: any, quem = c.editor) => request.patch(`${API_URL}/produtos/${produto.id}`, { headers: bearer(quem.token), data });
    const antes = (await (await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.admin.token) })).json()).atualizadoEm;
    // sem mudança real: sem evento e atualizadoEm intacto
    const igual = await patch({ nome: produto.nome, quantidade: 1, preco: '10.00', tagIds: [] });
    expect(igual.status()).toBe(200);
    expect((await igual.json()).atualizadoEm).toBe(antes);
    let h = await (await request.get(`${API_URL}/produtos/${produto.id}/historico`, { headers: bearer(c.leitor.token) })).json();
    expect(h.total).toBe(1);
    expect(h.itens[0]).toMatchObject({ tipo: 'CRIADO', detalhes: { quantidade: 1, preco: '10.00', fotos: 0 } });

    await patch({ quantidade: 3, preco: '12.50', tagIds: [tag.id], descricao: 'nova' });
    h = await (await request.get(`${API_URL}/produtos/${produto.id}/historico`, { headers: bearer(c.leitor.token) })).json();
    expect(h.total).toBe(2);
    expect(h.itens[0].tipo).toBe('ALTERADO');
    expect(h.itens[0].autor).toEqual({ nome: c.editor.nome });
    expect(h.itens[0].detalhes.alteracoes).toMatchObject({
      quantidade: { de: 1, para: 3 }, preco: { de: '10.00', para: '12.50' }, descricao: { de: null, para: 'nova' }, tags: { adicionadas: ['Garantia'], removidas: [] },
    });
    expect(h.itens[0].detalhes.alteracoes).not.toHaveProperty('nome');
    expect(h.itens[1].tipo).toBe('CRIADO');
    expect(JSON.stringify(h)).not.toContain('@e2e.keepit.test'); // sem e-mail no histórico
    const pag = await (await request.get(`${API_URL}/produtos/${produto.id}/historico?limite=1&pagina=2`, { headers: bearer(c.leitor.token) })).json();
    expect(pag).toMatchObject({ pagina: 2, limite: 1, total: 2, totalPaginas: 2 });
    expect(pag.itens[0].tipo).toBe('CRIADO');
    expect((await request.get(`${API_URL}/produtos/${produto.id}/historico?limite=101`, { headers: bearer(c.admin.token) })).status()).toBe(422);
  });

  test('PATCH de fotos: remover, adicionar, reordenar (capa) e histórico com contagens', async ({ request }) => {
    const c = await cenario(request);
    const { produto } = await criarProduto(request, c.admin, { fotos: [FOTOS.png, FOTOS.jpeg] });
    const [f0, f1] = produto.fotos;
    const patch = (data: any) => request.patch(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.admin.token), data });
    const rord = await patch({ fotos: [{ id: f1.id }, { id: f0.id }] });
    expect(rord.status(), await rord.text()).toBe(200);
    expect((await rord.json()).fotos.map((f: any) => f.id)).toEqual([f1.id, f0.id]);
    const nova = await enviarFotoPelaApi(request, c.admin, FOTOS.jpeg);
    const radd = await patch({ fotos: [{ id: f1.id }, { chave: nova.chave }] });
    const corpo = await radd.json();
    expect(corpo.fotos).toHaveLength(2);
    expect(corpo.fotos.map((f: any) => f.ordem)).toEqual([0, 1]);
    // a foto removida (f0) saiu do S3
    const removida = await request.get(urlDoS3(produto.fotos[0].url));
    expect(removida.status(), 'objeto da foto removida continua no S3').not.toBe(200);
    const h = await (await request.get(`${API_URL}/produtos/${produto.id}/historico`, { headers: bearer(c.admin.token) })).json();
    expect(h.itens[0].detalhes.alteracoes.fotos).toEqual({ adicionadas: 1, removidas: 1 });
    expect(h.itens[1].detalhes.alteracoes.fotos).toEqual({ adicionadas: 0, removidas: 0 });
  });

  test('DELETE: 204, remove fotos do S3 e vínculos, mantém as tags, histórico passa a 404', async ({ request }) => {
    const c = await cenario(request);
    const tag = await criarTag(request, c.admin, nomeUnico('Fica'));
    const { produto } = await criarProduto(request, c.admin, { tagIds: [tag.id], fotos: [FOTOS.png] });
    const url = urlDoS3(produto.fotos[0].url);
    expect((await request.get(url)).status()).toBe(200);
    expect((await request.delete(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.editor.token) })).status()).toBe(204);
    expect((await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.admin.token) })).status()).toBe(404);
    expect((await request.get(`${API_URL}/produtos/${produto.id}/historico`, { headers: bearer(c.admin.token) })).status()).toBe(404);
    await expect.poll(async () => (await request.get(url)).status(), { timeout: 10_000, message: 'objeto do S3 não foi apagado ao excluir o produto' }).not.toBe(200);
    const tags = await (await request.get(`${API_URL}/tags`, { headers: bearer(c.admin.token) })).json();
    expect(tags.itens.find((t: any) => t.id === tag.id)).toMatchObject({ quantidadeProdutos: 0 });
    const logs = await sql<{ acao: string }>(`select acao from log_auditoria where entidade='Produto' and entidade_id=$1 order by id`, [String(produto.id)]);
    expect(logs.map((l) => l.acao)).toEqual(['PRODUTO_CRIADO', 'PRODUTO_EXCLUIDO']);
  });

  test('auditoria: criar, alterar, somar e criar tag registram a ação certa com o usuário', async ({ request }) => {
    const c = await cenario(request);
    const t = await criarTag(request, c.admin, nomeUnico('Aud'));
    const nome = nomeUnico('Aud');
    const { produto } = await criarProduto(request, c.editor, { nome, quantidade: 1 });
    await request.patch(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.admin.token), data: { quantidade: 2 } });
    await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ nome, duplicado: 'SOMAR', duplicadoId: produto.id }) });
    const logs = await sql<{ acao: string; usuario_id: number }>(`select acao, usuario_id from log_auditoria where entidade='Produto' and entidade_id=$1 order by id`, [String(produto.id)]);
    expect(logs.map((l) => l.acao)).toEqual(['PRODUTO_CRIADO', 'PRODUTO_ALTERADO', 'PRODUTO_QUANTIDADE_SOMADA']);
    expect(logs.map((l) => l.usuario_id)).toEqual([c.editor.id, c.admin.id, c.admin.id]);
    const tl = await sql<{ acao: string }>(`select acao from log_auditoria where acao='TAG_CRIADA' and usuario_id=$1`, [c.admin.id]);
    expect(tl).toHaveLength(1);
    expect(t.id).toBeGreaterThan(0);
  });

  test('ex-membro: adicionadoPor vira null e o histórico mostra autor null (sem 500)', async ({ request }) => {
    const c = await cenario(request);
    const { produto } = await criarProduto(request, c.editor);
    const rem = await request.delete(`${API_URL}/casa/membros/${c.editor.id}`, { headers: bearer(c.admin.token) });
    expect(rem.status()).toBe(204);
    const det = await (await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.admin.token) })).json();
    expect(det.adicionadoPor).toBeNull();
    const h = await request.get(`${API_URL}/produtos/${produto.id}/historico`, { headers: bearer(c.admin.token) });
    expect(h.status()).toBe(200);
    expect((await h.json()).itens[0].autor).toBeNull();
    // o ex-membro já não acessa os produtos da Casa antiga
    const lista = await (await request.get(`${API_URL}/produtos`, { headers: bearer(c.editor.token) })).json();
    expect(lista.itens.map((p: any) => p.id)).not.toContain(produto.id);
    expect((await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.editor.token) })).status()).toBe(404);
  });

  test('rotina de órfãos não apaga objeto recente nem foto gravada e expõe fotosOrfasApagadas', async ({ request }) => {
    const c = await cenario(request);
    const { produto } = await criarProduto(request, c.admin, { fotos: [FOTOS.png] });
    const pendente = await enviarFotoPelaApi(request, c.admin, FOTOS.png);
    const r = await dispararJobs(request);
    expect(r).toHaveProperty('fotosOrfasApagadas');
    expect((await request.get(urlDoS3(produto.fotos[0].url))).status()).toBe(200);
    const salvo = await request.post(`${API_URL}/produtos`, { headers: bearer(c.admin.token), data: novoProdutoCorpo({ fotos: [{ chave: pendente.chave }] }) });
    expect(salvo.status(), 'foto pendente recente foi apagada pela rotina').toBe(201);
  });
});
