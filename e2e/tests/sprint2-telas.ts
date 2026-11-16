import type { Page, TestInfo } from '@playwright/test';
import { entrarEEsperar, expect, montarCasa, type CasaE2E } from './helpers';

/** Casa FAMILIA com ADMIN, EDITOR e LEITOR, criada uma vez por worker de teste. */
export async function prepararCasa(request: Parameters<typeof montarCasa>[0]): Promise<CasaE2E> {
  return montarCasa(request, { editores: 1, leitores: 1, prefixo: 'resp' });
}

export const TELAS_ADMIN = ['/familia', '/familia/adicionar', '/conta/planos', '/conta/planos/familia/pagamento', '/conta/assinatura', '/conta'];
export const TELAS_MEMBRO = ['/familia', '/conta/planos', '/conta'];

export async function semRolagemHorizontal(page: Page, rota: string) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `scrollWidth ${sw} > clientWidth ${cw} em ${rota}`).toBeLessThanOrEqual(cw);
}

export async function camposComRotulo(page: Page, rota: string) {
  const semNome = await page.evaluate(() =>
    [...document.querySelectorAll('input,select,textarea')]
      .filter((el) => {
        const e = el as HTMLInputElement;
        return e.type !== 'hidden' && !(e.labels && e.labels.length > 0) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby');
      })
      .map((el) => el.outerHTML.slice(0, 90)),
  );
  expect(semNome, `campos sem rótulo em ${rota}`).toEqual([]);
}

export async function botoesComNome(page: Page, rota: string) {
  const semNome = await page.evaluate(() =>
    [...document.querySelectorAll('button,a[href]')]
      .filter((el) => !(el.textContent ?? '').trim() && !el.getAttribute('aria-label'))
      .map((el) => el.outerHTML.slice(0, 90)),
  );
  expect(semNome, `botões/links sem nome em ${rota}`).toEqual([]);
}

/** Alvos de toque de pelo menos 44x44 px (RNF10), só os visíveis. */
export async function alvosDeToque(page: Page, rota: string) {
  const pequenos = await page.evaluate(() =>
    [...document.querySelectorAll('button,a[href],input[type=radio],input[type=checkbox]')]
      .map((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const rotulo = (el as HTMLInputElement).labels?.[0]?.getBoundingClientRect();
        const box = rotulo && rotulo.height > r.height ? rotulo : r;
        return { t: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30), w: box.width, h: box.height, v: r.width > 0 && r.height > 0 };
      })
      .filter((x) => x.v && (x.h < 44 || x.w < 44)),
  );
  expect(pequenos, `alvos de toque < 44px em ${rota}`).toEqual([]);
}

export async function temH1(page: Page, rota: string) {
  expect(await page.locator('h1').count(), `a tela ${rota} precisa de um <h1>`).toBeGreaterThan(0);
}

/** Tab percorre os controles e o foco fica visível (outline/box-shadow) no primeiro controle focado. */
export async function focoVisivel(page: Page, rota: string) {
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const estilo = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    return { tag: el.tagName, outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0, sombra: s.boxShadow !== 'none' };
  });
  expect(estilo, `nenhum controle recebeu foco por Tab em ${rota}`).not.toBeNull();
  expect(estilo!.outline || estilo!.sombra, `foco sem indicador visual em ${rota}`).toBe(true);
}

export async function capturar(page: Page, info: TestInfo, nome: string) {
  await page.screenshot({ path: `test-results/sprint2-telas/${info.project.name}-${nome}.png`, fullPage: true });
}

export const nomeArquivo = (rota: string) => rota.replace(/\//g, '_').replace(/^_/, '') || 'raiz';

export async function auditar(page: Page, info: TestInfo, rotas: string[], opcoes: { alvos: boolean }) {
  for (const rota of rotas) {
    await page.goto(rota);
    await expect(page.locator('#root')).not.toBeEmpty();
    await page.waitForLoadState('networkidle');
    await capturar(page, info, nomeArquivo(rota));
    await semRolagemHorizontal(page, rota);
    await camposComRotulo(page, rota);
    await botoesComNome(page, rota);
    await focoVisivel(page, rota);
    if (opcoes.alvos) await alvosDeToque(page, rota);
  }
}

export { entrarEEsperar };
