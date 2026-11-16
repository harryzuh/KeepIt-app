import { API_URL, bearer, calcularEstatisticas, centavos, criarProduto, criarTag, criarUsuario, dinheiro, expect, montarCasaComProdutos, PRODUTOS_CONHECIDOS, test } from './helpers';

// QA Sprint 4 (M4): API contra docs/api/m4-estatisticas.md. Números esperados calculados em centavos (BigInt), fora do backend.

const get = (request: any, rota: string, token?: string) => request.get(`${API_URL}${rota}`, token ? { headers: bearer(token) } : {});
const MONEY = /^\d+\.\d{2}$/;

test.describe('matriz de permissões e autenticação (RNF31)', () => {
  for (const rota of ['/estatisticas/resumo', '/estatisticas']) {
    test(`${rota}: sem token 401, token inválido 401, ADMIN/EDITOR/LEITOR 200 com o mesmo conteúdo`, async ({ request }) => {
      const c = await montarCasaComProdutos(request, { editores: 1, leitores: 1 });
      expect((await get(request, rota)).status()).toBe(401);
      const semToken = await (await get(request, rota)).json();
      expect(semToken.error).toBe('NAO_AUTENTICADO');
      expect((await get(request, rota, 'token.invalido.xyz')).status()).toBe(401);
      const corpos: unknown[] = [];
      for (const u of [c.admin, c.editor!, c.leitor!]) {
        const r = await get(request, rota, u.token);
        expect(r.status()).toBe(200);
        expect(r.headers()['cache-control']).toContain('no-store');
        corpos.push(await r.json());
      }
      expect(corpos[1]).toEqual(corpos[0]);
      expect(corpos[2]).toEqual(corpos[0]);
    });
  }

  test('métodos não GET não existem (404) e sub-rotas desconhecidas dão 404', async ({ request }) => {
    const u = await criarUsuario(request, 'm4api.met');
    for (const m of ['post', 'put', 'patch', 'delete'] as const) {
      const r = await request[m](`${API_URL}/estatisticas`, { headers: bearer(u.token), data: {} });
      expect([404, 405]).toContain(r.status());
    }
    expect((await get(request, '/estatisticas/1', u.token)).status()).toBe(404);
  });
});

test.describe('números conferidos à mão', () => {
  test('conjunto padrão: bate com o exemplo do contrato e com o cálculo independente', async ({ request }) => {
    const c = await montarCasaComProdutos(request, { editores: 0, leitores: 0 });
    const e = c.esperado;
    expect(e.valorTotal).toBe('5754.60');
    const r = await (await get(request, '/estatisticas', c.admin.token)).json();
    expect(r.valorTotal).toBe(e.valorTotal);
    expect(r.produtos).toBe(3);
    expect(r.unidades).toBe(45);
    expect(r.valorMedio).toBe('1918.20');
    expect(r.maiorGasto).toMatchObject({ nome: 'Notebook 14 polegadas', preco: '4599.00', quantidade: 1, valor: '4599.00' });
    expect(r.tagMaisComprada).toMatchObject({ nome: 'Utilidades', unidades: 40, produtos: 1 });
    expect(r.semTag).toEqual({ valor: '159.60', unidades: 4, produtos: 1 });
    expect(r.totalTagsComProduto).toBe(3);
    const porNome = Object.fromEntries(r.valorPorTag.map((t: any) => [t.nome, t]));
    for (const esp of e.valorPorTag) expect(porNome[esp.nome]).toMatchObject(esp);
    // Ordenação: valor desc, empate por nome A-Z (Eletrônicos e Garantia empatam em 4599.00).
    expect(r.valorPorTag.map((t: any) => t.nome)).toEqual(['Eletrônicos', 'Garantia', 'Utilidades']);
    expect(r.maisAntigos.map((p: any) => p.nome)).toEqual(['Notebook 14 polegadas', 'Pilhas AA (cartela)', 'Caixa organizadora']);
    for (const p of r.maisAntigos) expect(centavos(p.preco) * BigInt(p.quantidade)).toBe(centavos(p.valor));
    // Soma de valorPorTag passa do total (produto em 2 tags).
    expect(dinheiro(r.valorPorTag.reduce((s: bigint, t: any) => s + centavos(t.valor), 0n))).toBe('10194.00');
    const resumo = await (await get(request, '/estatisticas/resumo', c.admin.token)).json();
    expect(resumo).toMatchObject({ valorTotal: '5754.60', produtos: 3, unidades: 45, tags: 3, plano: { nome: 'FAMILIA' } });
    expect(resumo.membros).toEqual({ emUso: 1, limite: expect.any(Number) });
    expect(resumo.renovacao).toMatchObject({ status: 'ATIVA' });
    expect(JSON.stringify(resumo)).not.toMatch(/cartao|numero|ultimos|bandeira|pagamento/i);
  });

  test('consistência: total do resumo = total da tela 10 = soma da lista GET /produtos', async ({ request }) => {
    const c = await montarCasaComProdutos(request, { editores: 0, leitores: 0 });
    const resumo = await (await get(request, '/estatisticas/resumo', c.admin.token)).json();
    const completa = await (await get(request, '/estatisticas', c.admin.token)).json();
    const lista = await (await get(request, '/produtos?limite=100', c.admin.token)).json();
    const soma = lista.itens.reduce((s: bigint, p: any) => s + centavos(String(p.preco)) * BigInt(p.quantidade), 0n);
    expect(resumo.valorTotal).toBe(completa.valorTotal);
    expect(completa.valorTotal).toBe(dinheiro(soma));
  });

  test('Casa vazia: 200 com zeros, nulls e listas vazias (sem NaN nem erro)', async ({ request }) => {
    const c = await montarCasaComProdutos(request, { produtos: [], editores: 0, leitores: 0, plano: null });
    const r = await get(request, '/estatisticas', c.admin.token);
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({
      valorTotal: '0.00', produtos: 0, unidades: 0, valorMedio: '0.00', maiorGasto: null, tagMaisComprada: null,
      valorPorTag: [], totalTagsComProduto: 0, semTag: null, maisAntigos: [],
    });
    const s = await (await get(request, '/estatisticas/resumo', c.admin.token)).json();
    expect(s).toMatchObject({ valorTotal: '0.00', produtos: 0, unidades: 0, tags: 0, plano: { nome: 'INDIVIDUAL' }, renovacao: null });
  });

  test('tags sem produto contam no resumo e não entram em valorPorTag; produto com preço 0,00 conta em unidades', async ({ request }) => {
    const u = await criarUsuario(request, 'm4api.zero');
    await criarTag(request, u, 'Vazia');
    await criarProduto(request, u, { nome: 'Cabo grátis', preco: '0.00', quantidade: 3 });
    const r = await (await get(request, '/estatisticas', u.token)).json();
    expect(r).toMatchObject({ valorTotal: '0.00', produtos: 1, unidades: 3, valorMedio: '0.00', valorPorTag: [] });
    expect(r.maiorGasto).toMatchObject({ valor: '0.00' });
    expect(r.tagMaisComprada).toBeNull();
    expect(r.semTag).toEqual({ valor: '0.00', unidades: 3, produtos: 1 });
    expect((await (await get(request, '/estatisticas/resumo', u.token)).json()).tags).toBe(1);
  });

  test('valores máximos sem perda de precisão (preço 9999999999.99 x 1.000.000) e arredondamento meio para cima', async ({ request }) => {
    const u = await criarUsuario(request, 'm4api.max');
    await criarProduto(request, u, { nome: 'Gigante', preco: '9999999999.99', quantidade: 1_000_000 });
    await criarProduto(request, u, { nome: 'Pequeno', preco: '0.01', quantidade: 1 });
    await criarProduto(request, u, { nome: 'Pequeno 2', preco: '0.01', quantidade: 1 });
    const esperado = calcularEstatisticas([
      { nome: 'Gigante', preco: '9999999999.99', quantidade: 1_000_000, dias: 1, tags: [] },
      { nome: 'Pequeno', preco: '0.01', quantidade: 1, dias: 1, tags: [] },
      { nome: 'Pequeno 2', preco: '0.01', quantidade: 1, dias: 1, tags: [] },
    ]);
    const r = await (await get(request, '/estatisticas', u.token)).json();
    expect(r.valorTotal).toBe(esperado.valorTotal);
    expect(r.valorTotal).toBe('9999999999990000.02');
    expect(r.valorMedio).toBe(esperado.valorMedio);
    expect(r.maiorGasto.valor).toBe('9999999999990000.00');
    for (const campo of [r.valorTotal, r.valorMedio, r.maiorGasto.valor]) expect(campo).toMatch(MONEY);
  });

  test('empates: maior gasto pela compra mais recente; tag mais comprada desempata por nome', async ({ request }) => {
    const u = await criarUsuario(request, 'm4api.emp');
    const tb = await criarTag(request, u, 'Beta');
    const ta = await criarTag(request, u, 'alfa');
    await criarProduto(request, u, { nome: 'P antigo', preco: '5.00', quantidade: 4, dataCompra: '2026-01-01', tagIds: [tb.id] });
    await criarProduto(request, u, { nome: 'P novo', preco: '5.00', quantidade: 4, dataCompra: '2026-02-01', tagIds: [ta.id] });
    const r = await (await get(request, '/estatisticas', u.token)).json();
    expect(r.maiorGasto.nome).toBe('P novo'); // 20,00 vs 20,00: compra mais recente
    // 4 un. x 4 un., 1 produto cada: desempate por nome A-Z sem diferenciar caixa ("alfa" antes de "Beta").
    expect(r.tagMaisComprada).toMatchObject({ nome: 'alfa', unidades: 4, produtos: 1 });
  });
});

test.describe('isolamento entre Casas (RNF27)', () => {
  test('duas Casas com produtos e tags de mesmo nome: números independentes; casaId na query é ignorado', async ({ request }) => {
    const a = await montarCasaComProdutos(request, { editores: 0, leitores: 0, prefixo: 'm4iso.a' });
    const b = await montarCasaComProdutos(request, {
      editores: 0, leitores: 0, prefixo: 'm4iso.b',
      produtos: [{ ...PRODUTOS_CONHECIDOS[0], quantidade: 3 }],
    });
    const ra = await (await get(request, '/estatisticas', a.admin.token)).json();
    const rb = await (await get(request, '/estatisticas?casaId=1', b.admin.token)).json();
    expect(ra.valorTotal).toBe('5754.60');
    expect(rb.valorTotal).toBe('13797.00');
    expect(rb.produtos).toBe(1);
    expect(rb.valorPorTag.map((t: any) => t.nome).sort()).toEqual(['Eletrônicos', 'Garantia']);
    // criar produto na Casa B não altera A.
    await criarProduto(request, b.admin, { nome: 'Extra', preco: '1.00' });
    expect((await (await get(request, '/estatisticas', a.admin.token)).json()).valorTotal).toBe('5754.60');
    // tentativa de apontar outra Casa por parâmetro de caminho/cabeçalho/query não muda nada
    const h = { ...bearer(b.admin.token), 'x-casa-id': String(a.admin.id) };
    const r2 = await (await request.get(`${API_URL}/estatisticas/resumo?casaId=${a.admin.id}&casa_id=${a.admin.id}`, { headers: h })).json();
    expect(r2.produtos).toBe(2);
  });

  test('parâmetros inválidos na query são ignorados (200), inclusive injeção de SQL', async ({ request }) => {
    const c = await montarCasaComProdutos(request, { editores: 0, leitores: 0 });
    for (const q of ["?casaId=abc", "?casaId=1' OR '1'='1", '?limite=-1&pagina=0', '?a[]=1&a[b]=2', '?casaId=' + 'x'.repeat(5000)]) {
      const r = await request.get(`${API_URL}/estatisticas${q}`, { headers: bearer(c.admin.token) });
      expect(r.status(), q.slice(0, 40)).toBe(200);
      expect((await r.json()).valorTotal).toBe('5754.60');
    }
  });

  test('usuário removido da Casa deixa de ver os números da Casa antiga (token relido a cada requisição)', async ({ request }) => {
    const c = await montarCasaComProdutos(request, { editores: 1, leitores: 0 });
    const antes = await (await get(request, '/estatisticas', c.editor!.token)).json();
    expect(antes.valorTotal).toBe('5754.60');
    const rem = await request.delete(`${API_URL}/casa/membros/${c.editor!.id}`, { headers: bearer(c.admin.token) });
    expect([200, 204]).toContain(rem.status());
    const depois = await get(request, '/estatisticas', c.editor!.token);
    // Deve devolver só dados da nova Casa (vazia) ou negar; nunca os da Casa antiga.
    if (depois.status() === 200) expect((await depois.json()).valorTotal).toBe('0.00');
    else expect([401, 403]).toContain(depois.status());
  });
});

test('50 requisições simultâneas respondem 200 em tempo razoável (RNF06)', async ({ request }) => {
  const c = await montarCasaComProdutos(request, { editores: 0, leitores: 0 });
  const t0 = Date.now();
  const rs = await Promise.all(Array.from({ length: 50 }, (_, i) => get(request, i % 2 ? '/estatisticas' : '/estatisticas/resumo', c.admin.token)));
  expect(rs.map((r) => r.status()).filter((s) => s !== 200 && s !== 429)).toEqual([]);
  expect(Date.now() - t0).toBeLessThan(2000);
});
