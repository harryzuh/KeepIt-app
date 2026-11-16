import type { Page } from '@playwright/test';
import { expect, test, entrarEEsperar } from './helpers';

// Usuário do seed (backend/prisma/seed.ts): evita gastar o limite de 10 cadastros/hora por IP. Só navegação, nada é alterado.
const DEMO = { email: 'demo@keepit.local', senha: 'keepit-demo-123' };

// Responsividade (RNF10) e acessibilidade básica em 375x812 e desktop.
const publicas = ['/', '/entrar', '/criar-conta', '/recuperar-senha', '/termos'];
const logadas = ['/inicio', '/conta', '/conta/dados', '/conta/senha'];

async function semRolagemHorizontal(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw);
}

async function camposComRotulo(page: Page) {
  const semNome = await page.evaluate(() =>
    [...document.querySelectorAll('input,select,textarea')]
      .filter((el) => {
        const e = el as HTMLInputElement;
        if (e.type === 'hidden') return false;
        const rotulo = e.labels && e.labels.length > 0;
        return !rotulo && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby');
      })
      .map((el) => el.outerHTML.slice(0, 80)),
  );
  expect(semNome).toEqual([]);
}

async function botoesComNome(page: Page) {
  const semNome = await page.evaluate(() =>
    [...document.querySelectorAll('button,a[href]')]
      .filter((el) => !(el.textContent ?? '').trim() && !el.getAttribute('aria-label'))
      .map((el) => el.outerHTML.slice(0, 80)),
  );
  expect(semNome).toEqual([]);
}

for (const [nome, viewport] of [
  ['mobile 375x812', { width: 375, height: 812 }],
  ['desktop 1280x800', { width: 1280, height: 800 }],
] as const) {
  test.describe(nome, () => {
    test.use({ viewport });

    test('telas públicas: sem rolagem horizontal, campos com rótulo, idioma e título', async ({ page }) => {
      for (const rota of publicas) {
        await page.goto(rota);
        await expect(page.locator('#root')).not.toBeEmpty();
        await semRolagemHorizontal(page);
        await camposComRotulo(page);
        await botoesComNome(page);
        expect(await page.locator('html').getAttribute('lang'), `lang em ${rota}`).toMatch(/^pt/);
        await expect(page, `título em ${rota}`).toHaveTitle(/.+/);
        await expect(page.locator('h1').first(), `h1 em ${rota}`).toBeVisible();
      }
    });

    test('telas logadas: navegação adequada ao tamanho e sem rolagem horizontal', async ({ page }) => {
      await entrarEEsperar(page, DEMO.email, DEMO.senha);
      await expect(page).toHaveURL(/\/inicio$/);
      for (const rota of logadas) {
        await page.goto(rota);
        await expect(page.locator('#root')).not.toBeEmpty();
        await semRolagemHorizontal(page);
        await camposComRotulo(page);
        await botoesComNome(page);
      }
      await page.goto('/conta');
      const nav = page.getByRole('navigation', { name: 'Principal' });
      if (viewport.width < 768) {
        // tab bar no celular: item Conta visível e alvo de toque >= 44 px
        const conta = page.getByRole('link', { name: 'Conta' }).last();
        await expect(conta).toBeVisible();
        const box = await conta.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      } else {
        await expect(nav).toBeVisible();
      }
    });
  });
}

test('foco: formulário de entrar é navegável por teclado e o foco é visível', async ({ page }) => {
  await page.goto('/entrar');
  await page.keyboard.press('Tab'); // voltar
  await page.keyboard.press('Tab'); // e-mail
  await expect(page.getByLabel('E-mail')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Senha', { exact: true })).toBeFocused();
});

test('banner offline (RNF24) aparece sem conexão', async ({ page, context }) => {
  await page.goto('/entrar');
  await context.setOffline(true);
  await expect(page.getByText(/Sem conexão/)).toBeVisible();
  await context.setOffline(false);
});

test('rota inexistente mostra "Página não encontrada"', async ({ page }) => {
  await page.goto('/nao-existe');
  await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
});
