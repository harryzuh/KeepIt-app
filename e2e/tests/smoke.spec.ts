import { expect, test } from '@playwright/test';

test('a home abre e renderiza a aplicação', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));

  const resposta = await page.goto('/');
  expect(resposta?.ok()).toBeTruthy();
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page).toHaveTitle(/.+/);
  expect(erros).toEqual([]);
});
