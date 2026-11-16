import { expect, test } from './helpers';
import { auditar, entrarEEsperar, prepararCasa, TELAS_ADMIN, TELAS_MEMBRO } from './sprint2-telas';

// Telas novas da Sprint 2 em desktop 1280x800: sem rolagem horizontal, rótulos, foco e screenshots.
test.use({ viewport: { width: 1280, height: 800 } });

test('ADMIN: telas 11, 12, 13, 14, 15 em desktop', async ({ page, request }, info) => {
  const c = await prepararCasa(request);
  await entrarEEsperar(page, c.admin.email);
  await auditar(page, info, TELAS_ADMIN, { alvos: false });
});

test('LEITOR: telas 11 e 13 em desktop', async ({ page, request }, info) => {
  const c = await prepararCasa(request);
  await entrarEEsperar(page, c.leitor!.email);
  await auditar(page, info, TELAS_MEMBRO, { alvos: false });
});

test('modais (tela 22, cancelar, tela 24) em desktop: foco vai para o modal, Esc fecha', async ({ page, request }, info) => {
  const c = await prepararCasa(request);
  await entrarEEsperar(page, c.admin.email);
  await page.goto('/familia');
  await page.getByRole('button', { name: /^Gerenciar/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: `test-results/sprint2-telas/${info.project.name}-modal-membro.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/conta/assinatura');
  await page.getByRole('button', { name: 'Cancelar assinatura' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const dentro = await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
  expect(dentro, 'o foco deve ir para dentro do modal ao abrir').toBe(true);
});

test('cada tela nova tem um <h1> (estrutura de títulos)', async ({ page, request }) => {
  const c = await prepararCasa(request);
  await entrarEEsperar(page, c.admin.email);
  const semH1: string[] = [];
  for (const rota of TELAS_ADMIN) {
    await page.goto(rota);
    await page.waitForLoadState('networkidle');
    if ((await page.locator('h1').count()) === 0) semH1.push(rota);
  }
  expect(semH1, 'telas sem <h1> (o título de PaginaForm é um <p>)').toEqual([]);
});
