import { expect, test } from './helpers';
import { alvosDeToqueM3, auditarTela, capturar, entrarEEsperar, esperarImagens, prepararCenarioM3 } from './m3-telas';
import { semRolagemHorizontal } from './sprint2-telas';

// Telas novas da Sprint 3 em 360x800 (RNF10): rolagem horizontal, rótulos, alt, alvos de toque >= 44px, foco e screenshots.

test('ADMIN: telas 05, 06, 07, 08 (cadastro e edição) em 360px', async ({ page, request }, info) => {
  const c = await prepararCenarioM3(request);
  await entrarEEsperar(page, c.casa.admin.email);
  for (const [rota, nome] of [
    ['/inicio', 'inicio'],
    ['/produtos', 'produtos'],
    [`/produtos/${c.produtoId}`, 'detalhe'],
    ['/produtos/novo', 'cadastro'],
    [`/produtos/${c.produtoId}/editar`, 'edicao'],
  ] as const) {
    await auditarTela(page, info, rota, { alvos: true, nome });
  }
});

test('LEITOR: telas 05, 06 e 07 em 360px (sem ações de edição)', async ({ page, request }, info) => {
  const c = await prepararCenarioM3(request);
  await entrarEEsperar(page, c.casa.leitor!.email);
  for (const [rota, nome] of [
    ['/inicio', 'leitor-inicio'],
    ['/produtos', 'leitor-produtos'],
    [`/produtos/${c.produtoId}`, 'leitor-detalhe'],
  ] as const) {
    await auditarTela(page, info, rota, { alvos: true, nome });
  }
});

test('tela 08 com 3 fotos enviadas e erro de cota cabem em 360px', async ({ page, request }, info) => {
  const c = await prepararCenarioM3(request);
  await entrarEEsperar(page, c.casa.admin.email);
  await page.goto('/produtos/novo');
  await page.getByLabel('Nome do produto').fill('Produto com três fotos e nome comprido');
  await page.getByTestId('entrada-fotos').setInputFiles(['fixtures/foto-valida.jpg', 'fixtures/foto-valida.png', 'fixtures/png-renomeado.jpg']);
  await expect(page.getByText(/Enviada ·/)).toHaveCount(3);
  await capturar(page, info, 'cadastro-3-fotos');
  await semRolagemHorizontal(page, 'cadastro com 3 fotos');
  await alvosDeToqueM3(page, 'cadastro com 3 fotos');
  await page.getByTestId('entrada-fotos').setInputFiles('fixtures/foto-maior-que-5mb.jpg');
  await expect(page.getByRole('alert').filter({ hasText: /até (5 MB|3 fotos)/ })).toBeVisible();
  await capturar(page, info, 'cadastro-erro-foto');
  await semRolagemHorizontal(page, 'cadastro com erro de foto');
});

test('modais da tela 09 (duplicado) e da tela 23 (excluir) cabem em 360px e o botão Salvar não fica atrás da barra inferior', async ({ page, request }, info) => {
  const c = await prepararCenarioM3(request);
  await entrarEEsperar(page, c.casa.admin.email);
  await page.goto('/produtos/novo');
  await page.getByLabel('Nome do produto').fill(c.produtoNome);
  await page.getByLabel('Preço (R$)').fill('10,00');
  await page.getByRole('button', { name: 'Salvar produto' }).click();
  const modal = page.getByRole('dialog', { name: 'Este produto já existe' });
  await expect(modal).toBeVisible();
  await esperarImagens(page);
  await capturar(page, info, 'modal-duplicado');
  const caixa = await modal.boundingBox();
  expect(caixa!.x).toBeGreaterThanOrEqual(0);
  expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(360);
  for (const nome of ['Somar à quantidade', 'Cadastrar mesmo assim', 'Cancelar']) {
    const b = await modal.getByRole('button', { name: nome }).boundingBox();
    expect(b!.height, nome).toBeGreaterThanOrEqual(44);
    expect(b!.x + b!.width, nome).toBeLessThanOrEqual(360);
  }
  await modal.getByRole('button', { name: 'Cancelar' }).click();

  await page.goto(`/produtos/${c.produtoId}`);
  await page.getByRole('button', { name: 'Excluir produto' }).click();
  const m2 = page.getByRole('dialog', { name: 'Excluir produto?' });
  await expect(m2).toBeVisible();
  await capturar(page, info, 'modal-excluir');
  const c2 = await m2.boundingBox();
  expect(c2!.x + c2!.width).toBeLessThanOrEqual(360);
});

test('ação final de cada tela não fica escondida atrás da barra de navegação inferior', async ({ page, request }) => {
  const c = await prepararCenarioM3(request);
  await entrarEEsperar(page, c.casa.admin.email);
  const casos: [string, string][] = [
    ['/produtos/novo', 'Salvar produto'],
    [`/produtos/${c.produtoId}/editar`, 'Salvar alterações'],
    [`/produtos/${c.produtoId}`, 'Excluir produto'],
  ];
  for (const [rota, nome] of casos) {
    await page.goto(rota);
    const alvo = page.getByRole('link', { name: nome }).or(page.getByRole('button', { name: nome })).first();
    await expect(alvo).toBeVisible();
    await alvo.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const ok = await alvo.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const topo = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, window.innerHeight - 1));
      return !!topo && (el === topo || el.contains(topo));
    });
    expect(ok, `"${nome}" coberto por outro elemento ao rolar até o fim de ${rota}`).toBe(true);
  }
});

test('o "+" da barra inferior abre o cadastro (ADMIN) e some para o LEITOR', async ({ page, request }) => {
  const c = await prepararCenarioM3(request);
  await entrarEEsperar(page, c.casa.admin.email);
  await page.getByRole('link', { name: 'Adicionar produto', exact: true }).click();
  await expect(page).toHaveURL(/\/produtos\/novo$/);
  await page.evaluate(() => localStorage.clear());
  await entrarEEsperar(page, c.casa.leitor!.email);
  await expect(page.getByRole('link', { name: 'Adicionar produto', exact: true })).toHaveCount(0);
});

test('lista com muitos filtros: chips de tag rolam na horizontal dentro do próprio grupo, sem rolar a página', async ({ page, request }) => {
  const c = await prepararCenarioM3(request);
  for (let i = 0; i < 12; i++) await (await request.post(`${process.env.E2E_API_URL ?? 'http://localhost:3333'}/tags`, { headers: { Authorization: `Bearer ${c.casa.admin.token}` }, data: { nome: `Categoria número ${i}` } })).json();
  await entrarEEsperar(page, c.casa.admin.email);
  await page.goto('/produtos');
  await expect(page.getByRole('group', { name: 'Filtrar por tag' })).toBeVisible();
  await semRolagemHorizontal(page, '/produtos com 13 tags');
});

test('campo "Nova tag" da tela 08 tem largura utilizável (>= 120px) ao lado do botão Criar tag', async ({ page, request }) => {
  const c = await prepararCenarioM3(request);
  await entrarEEsperar(page, c.casa.admin.email);
  await page.goto('/produtos/novo');
  const caixa = await page.getByLabel('Nova tag').boundingBox();
  expect(caixa!.width, `campo "Nova tag" com apenas ${Math.round(caixa!.width)}px de largura`).toBeGreaterThanOrEqual(120);
});
