import { API_URL, bearer, calcularEstatisticas, montarCasaComProdutos, PRODUTOS_CONHECIDOS, criarProduto, criarTag, criarUsuario, dispararJobs, enviarFotoPelaApi, expect, FOTOS, montarCasa, obterPerfil, test, urlDoS3 } from './helpers';

// Verificação dos helpers de E2E (infra). Não valida regra de negócio: isso é dos specs de fluxo do QA.
test.describe('helpers de e2e', () => {
  test('criarUsuario e dispararJobs funcionam com o JOBS_TOKEN do ambiente', async ({ request }) => {
    const u = await criarUsuario(request, 'infra');
    expect((await obterPerfil(request, u)).email).toBe(u.email);
    const r = await dispararJobs(request);
    expect(r.apagadas).toBeGreaterThanOrEqual(0);
  });

  // Habilitar quando as rotas das histórias 7.1, 7.2, 7.3 e 6.2 estiverem no ar (remover o .fixme).
  test('montarCasa cria Casa FAMILIA com ADMIN, EDITOR e LEITOR', async ({ request }) => {
    const casa = await montarCasa(request);
    expect((await obterPerfil(request, casa.editor!)).papel).toBe('EDITOR');
    expect((await obterPerfil(request, casa.leitor!)).papel).toBe('LEITOR');
  });
});

// Sprint 3: as rotas de tags, fotos e produtos dependem do backend do M3; habilitar com a API no ar.
test.describe('helpers de e2e do M3 (tags, fotos e produtos)', () => {
  // Enquanto o módulo de produtos do backend não existe (rota 404), os testes são pulados em vez de falhar.
  test.beforeAll(async ({ request }) => {
    const r = await request.post(`${API_URL}/produtos/fotos/upload-url`, { data: {} });
    test.skip(r.status() === 404, 'backend do M3 ainda sem as rotas de produtos/fotos');
  });

  test('URL assinada: PUT pelo proxy /s3 do front e leitura de volta', async ({ request }) => {
    const u = await criarUsuario(request, 'infra.foto');
    const { chave } = await enviarFotoPelaApi(request, u, FOTOS.png);
    expect(chave).toMatch(/^casas\/\d+\/(fotos|pendentes)\/.+\.png$/);
  });

  test('criarTag, criarProduto com foto e leitura pelo GET /produtos/:id', async ({ request }) => {
    const u = await criarUsuario(request, 'infra.prod');
    const tag = await criarTag(request, u, 'Cozinha');
    const { resultado, produto } = await criarProduto(request, u, { tagIds: [tag.id], fotos: [FOTOS.jpeg, FOTOS.pngRenomeado] });
    expect(resultado).toBe('CRIADO');
    const r = await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(u.token) });
    const det = (await r.json()) as { fotos: { url: string; tipo: string }[] };
    expect(det.fotos.map((f) => f.tipo)).toEqual(['JPEG', 'PNG']);
    // A URL de leitura assinada também funciona pelo proxy /s3
    const img = await request.get(urlDoS3(det.fotos[0].url));
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toContain('image/jpeg');
  });
});

// Sprint 4: os helpers de estatísticas. O cálculo esperado é puro (sem API); a Casa montada é conferida contra o M4 quando a rota existir.
test.describe('helpers de e2e do M4 (Casa com produtos conhecidos)', () => {
  test('calcularEstatisticas confere com os números do contrato (sem API)', () => {
    const e = calcularEstatisticas(PRODUTOS_CONHECIDOS);
    expect(e.valorTotal).toBe('5754.60');
    expect([e.produtos, e.unidades, e.valorMedio]).toEqual([3, 45, '1918.20']);
    expect(e.maiorGasto).toEqual({ nome: 'Notebook 14 polegadas', valor: '4599.00' });
    expect(e.tagMaisComprada).toEqual({ nome: 'Utilidades', unidades: 40, produtos: 1 });
    expect(e.semTag).toEqual({ valor: '159.60', unidades: 4, produtos: 1 });
    expect(e.maisAntigos[0]).toBe('Notebook 14 polegadas');
    const vazio = calcularEstatisticas([]);
    expect([vazio.valorTotal, vazio.valorMedio, vazio.maiorGasto, vazio.tagMaisComprada]).toEqual(['0.00', '0.00', null, null]);
  });

  test('montarCasaComProdutos cria produtos e tags; a API de estatísticas concorda', async ({ request }) => {
    const casa = await montarCasaComProdutos(request);
    const lista = await request.get(`${API_URL}/produtos?limite=50`, { headers: bearer(casa.admin.token) });
    expect(lista.status()).toBe(200);
    expect(Object.keys(casa.tags).sort()).toEqual(['Eletrônicos', 'Garantia', 'Utilidades']);
    const r = await request.get(`${API_URL}/estatisticas`, { headers: bearer(casa.leitor!.token) });
    test.skip(r.status() === 404, 'backend do M4 ainda sem as rotas de estatísticas');
    const corpo = await r.json();
    expect(corpo.valorTotal).toBe(casa.esperado.valorTotal);
    expect(corpo.valorMedio).toBe(casa.esperado.valorMedio);
  });
});
