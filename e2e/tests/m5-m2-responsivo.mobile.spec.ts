import { expect, test } from './helpers';
import { auditar, capturar, entrarEEsperar, prepararCasa, TELAS_ADMIN, TELAS_MEMBRO } from './sprint2-telas';

// Telas novas da Sprint 2 em 360x800 (RNF10): rolagem horizontal, rótulos, alvos de toque >= 44px, foco e screenshots.

test('ADMIN: telas 11, 12, 13, 14, 15 em 360px', async ({ page, request }, info) => {
  const c = await prepararCasa(request);
  await entrarEEsperar(page, c.admin.email);
  await auditar(page, info, TELAS_ADMIN, { alvos: true });
});

test('LEITOR: telas 11 e 13 em 360px', async ({ page, request }, info) => {
  const c = await prepararCasa(request);
  await entrarEEsperar(page, c.leitor!.email);
  await auditar(page, info, TELAS_MEMBRO, { alvos: true });
});

test('modais da tela 22, de cancelamento e da tela 24 cabem em 360px', async ({ page, request }, info) => {
  const c = await prepararCasa(request);
  await entrarEEsperar(page, c.admin.email);
  await page.goto('/familia');
  await page.getByRole('button', { name: /^Gerenciar/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await capturar(page, info, 'modal-membro');
  await page.getByRole('button', { name: 'Remover da Casa' }).click();
  await capturar(page, info, 'modal-remover');
  const caixa = await page.getByRole('dialog').boundingBox();
  expect(caixa!.x).toBeGreaterThanOrEqual(0);
  expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(360);
  await page.goto('/conta/assinatura');
  await page.getByRole('button', { name: 'Cancelar assinatura' }).click();
  await capturar(page, info, 'modal-cancelar');
  await page.evaluate(() => localStorage.clear());

  await entrarEEsperar(page, c.leitor!.email);
  await page.goto('/conta/planos');
  await page.getByRole('button', { name: 'Assinar Família' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await capturar(page, info, 'modal-tela24');
  const c24 = await page.getByRole('dialog').boundingBox();
  expect(c24!.x + c24!.width).toBeLessThanOrEqual(360);
});

test('ação final de cada tela não fica escondida atrás da barra de navegação inferior', async ({ page, request }) => {
  const c = await prepararCasa(request);
  await entrarEEsperar(page, c.admin.email);
  const casos: [string, string][] = [
    ['/familia', '+ Adicionar membro'],
    ['/conta/assinatura', 'Cancelar assinatura'],
  ];
  for (const [rota, nome] of casos) {
    await page.goto(rota);
    const alvo = page.getByRole('link', { name: nome }).or(page.getByRole('button', { name: nome })).first();
    await expect(alvo).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const ok = await alvo.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const topo = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, window.innerHeight - 1));
      return !!topo && (el === topo || el.contains(topo));
    });
    expect(ok, `"${nome}" coberto por outro elemento ao rolar até o fim de ${rota}`).toBe(true);
  }
});
