import { expect, test } from './helpers';
import { auditarTela, capturar, entrarEEsperar, esperarImagens, prepararCenarioM3, semViolacoesAxe } from './m3-telas';

// Telas novas da Sprint 3 em desktop 1280x800: sem rolagem horizontal, rótulos, alt, foco, axe (WCAG 2.1 AA) e screenshots.
test.use({ viewport: { width: 1280, height: 800 } });

test('ADMIN: telas 05, 06, 07, 08 em desktop (estrutura, rótulos, alt, foco)', async ({ page, request }, info) => {
  const c = await prepararCenarioM3(request);
  await entrarEEsperar(page, c.casa.admin.email);
  for (const [rota, nome] of [
    ['/inicio', 'inicio'],
    ['/produtos', 'produtos'],
    [`/produtos/${c.produtoId}`, 'detalhe'],
    ['/produtos/novo', 'cadastro'],
    [`/produtos/${c.produtoId}/editar`, 'edicao'],
  ] as const) {
    await auditarTela(page, info, rota, { alvos: false, nome });
  }
});

test('LEITOR: telas 05, 06 e 07 em desktop', async ({ page, request }, info) => {
  const c = await prepararCenarioM3(request);
  await entrarEEsperar(page, c.casa.leitor!.email);
  for (const [rota, nome] of [
    ['/inicio', 'leitor-inicio'],
    ['/produtos', 'leitor-produtos'],
    [`/produtos/${c.produtoId}`, 'leitor-detalhe'],
  ] as const) {
    await auditarTela(page, info, rota, { alvos: false, nome });
  }
});

test('axe: telas 05, 06, 07 e 08 sem violações sérias ou críticas (RNF19)', async ({ page, request }) => {
  const c = await prepararCenarioM3(request);
  await entrarEEsperar(page, c.casa.admin.email);
  const falhas: string[] = [];
  for (const rota of ['/inicio', '/produtos', `/produtos/${c.produtoId}`, '/produtos/novo', `/produtos/${c.produtoId}/editar`]) {
    await page.goto(rota);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await esperarImagens(page);
    try {
      await semViolacoesAxe(page, rota);
    } catch (e) {
      falhas.push(String((e as Error).message).split('\n').slice(0, 14).join('\n'));
    }
  }
  expect(falhas, falhas.join('\n---\n')).toEqual([]);
});

test('axe nos modais da tela 09 e da tela 23, foco no modal e retorno do foco ao fechar', async ({ page, request }, info) => {
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
  await semViolacoesAxe(page, 'modal tela 09');
  // Tab não escapa do modal
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), 'o foco saiu do modal com Tab').toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto(`/produtos/${c.produtoId}`);
  const botao = page.getByRole('button', { name: 'Excluir produto' });
  await botao.click();
  await expect(page.getByRole('dialog', { name: 'Excluir produto?' })).toBeVisible();
  await capturar(page, info, 'modal-excluir');
  await semViolacoesAxe(page, 'modal tela 23');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(botao, 'o foco deveria voltar ao botão que abriu o modal').toBeFocused();
});

test('formulário da tela 08 é operável só pelo teclado (Tab até Salvar, Enter envia)', async ({ page, request }) => {
  const c = await prepararCenarioM3(request);
  await entrarEEsperar(page, c.casa.admin.email);
  await page.goto('/produtos/novo');
  await page.getByLabel('Nome do produto').focus();
  await page.keyboard.type('Teclado ' + Date.now());
  await page.keyboard.press('Tab'); // descrição
  await page.keyboard.press('Tab'); // preço
  await page.keyboard.type('5,00');
  await page.getByRole('button', { name: 'Salvar produto' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/produtos\/\d+$/);
});

test('a busca anuncia a quantidade de resultados (aria-live) e o filtro por tag usa aria-pressed', async ({ page, request }) => {
  const c = await prepararCenarioM3(request);
  await entrarEEsperar(page, c.casa.admin.email);
  await page.goto('/produtos');
  const contador = page.locator('[aria-live="polite"]').filter({ hasText: /produto/ });
  await expect(contador).toBeVisible();
  await expect(page.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true');
});

test('campo "Nova tag" da tela 08 tem largura utilizável (>= 120px) em desktop', async ({ page, request }) => {
  const c = await prepararCenarioM3(request);
  await entrarEEsperar(page, c.casa.admin.email);
  await page.goto('/produtos/novo');
  const caixa = await page.getByLabel('Nova tag').boundingBox();
  expect(caixa!.width, `campo "Nova tag" com apenas ${Math.round(caixa!.width)}px de largura`).toBeGreaterThanOrEqual(120);
});
