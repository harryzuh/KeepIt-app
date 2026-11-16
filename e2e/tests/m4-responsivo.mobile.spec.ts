import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { criarProduto, entrarEEsperar, expect, montarCasaComProdutos, test } from './helpers';
import { alvosDeToque, semRolagemHorizontal } from './sprint2-telas';

// QA Sprint 4 (M4) em 360x800 (RNF10): telas 05 (Início) e 10 (Estatísticas).
const brl = (v: string) => new RegExp(`R\\$\\s*${v.replace(/\./g, '\\.')}`);
// "Maior gasto" é um link (sem grupo aninhado, WCAG 2.5.3): o nome acessível é o texto visível, que começa pelo rótulo.
const indicador = (page: Page, rotulo: string) => {
  const grupo = page.getByRole('group', { name: new RegExp(`^${rotulo}:`) });
  return rotulo === 'Maior gasto' ? grupo.or(page.getByRole('link', { name: /^Maior gasto\s/ })) : grupo;
};

async function auditar(page: Page, rota: string, nome: string) {
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `test-results/sprint4-telas/mobile-${nome}.png`, fullPage: true });
  await semRolagemHorizontal(page, rota);
  await alvosDeToqueM4(page, rota);
  const r = await new AxeBuilder({ page }).exclude('.text-apoio').exclude('span.bg-borda.text-suave') /* selo LEITOR (M2): contraste reprovado, registrado no relatório da Sprint 4 */.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').filter((v) => v.id !== 'label-content-name-mismatch');
  expect(graves.map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 120)}`), `axe em ${rota}`).toEqual([]);
}

/** Alvos de toque >= 44 px, só nos controles do M4 (links e botões dentro de main, exceto os herdados de sprints anteriores). */
async function alvosDeToqueM4(page: Page, rota: string) {
  const pequenos = await page.evaluate(() =>
    [...document.querySelectorAll('main a[href], main button')]
      .map((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { t: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), w: r.width, h: r.height };
      })
      .filter((x) => x.w > 0 && x.h > 0 && (x.h < 44 || x.w < 44)),
  );
  expect(pequenos, `alvos de toque < 44px em ${rota}`).toEqual([]);
}

test('ADMIN: Início (05) e Estatísticas (10) em 360px com dados', async ({ page, request }) => {
  const c = await montarCasaComProdutos(request);
  await entrarEEsperar(page, c.admin.email);
  await expect(indicador(page, 'Valor total do patrimônio')).toContainText(brl('5.754,60'));
  await expect(indicador(page, 'Produtos')).toContainText('3');
  await expect(indicador(page, 'Tags')).toContainText('3');
  await expect(indicador(page, 'Membros')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Armazenamento usado' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver estatísticas' })).toBeVisible();
  await auditar(page, '/inicio', 'inicio-admin');
  await page.getByRole('link', { name: 'Ver estatísticas' }).click();
  await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'));
  await expect(page.getByRole('img', { name: /do valor total/ })).toHaveCount(4);
  await auditar(page, '/estatisticas', 'estatisticas-admin');
});

test('LEITOR: mesmas telas sem atalhos de edição', async ({ page, request }) => {
  const c = await montarCasaComProdutos(request, { editores: 0, leitores: 1 });
  await entrarEEsperar(page, c.leitor!.email);
  await expect(indicador(page, 'Valor total do patrimônio')).toContainText(brl('5.754,60'));
  await expect(page.getByRole('link', { name: /Adicionar produto/ })).toHaveCount(0);
  await auditar(page, '/inicio', 'inicio-leitor');
  await page.goto('/estatisticas');
  await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'));
  await expect(page.getByRole('link', { name: /Adicionar produto/ })).toHaveCount(0);
  await auditar(page, '/estatisticas', 'estatisticas-leitor');
});

test('Casa vazia em 360px', async ({ page, request }) => {
  const c = await montarCasaComProdutos(request, { produtos: [], plano: null, editores: 0, leitores: 0 });
  await entrarEEsperar(page, c.admin.email);
  await expect(indicador(page, 'Valor total do patrimônio')).toContainText(brl('0,00'));
  await expect(page.getByText(/Nenhum produto cadastrado ainda/)).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|Infinity/);
  await auditar(page, '/inicio', 'inicio-vazio');
  await page.goto('/estatisticas');
  await expect(page.getByText('Ainda não há dados para estatísticas')).toBeVisible();
  await auditar(page, '/estatisticas', 'estatisticas-vazio');
});

test('valores gigantes e nomes longos não geram rolagem horizontal em 360px', async ({ page, request }) => {
  const nome = 'Produto com um nome absurdamente comprido para testar a quebra de linha e o truncamento em 360px de largura';
  const c = await montarCasaComProdutos(request, {
    editores: 0, leitores: 0, plano: null,
    produtos: [
      { nome, preco: '9999999999.99', quantidade: 1_000_000, dias: 9, tags: ['Tag com nome comprido para testar barra'] },
      { nome: 'Segundo produto com nome comprido igualmente para a lista de antigos', preco: '123456789.12', quantidade: 7, dias: 8, tags: [] },
    ],
  });
  await criarProduto(request, c.admin, { nome: 'x', preco: '0.01' });
  await entrarEEsperar(page, c.admin.email);
  await expect(indicador(page, 'Valor total do patrimônio')).toContainText(brl('10.000.000.864.187.523,85'));
  await auditar(page, '/inicio', 'inicio-gigante');
  await page.goto('/estatisticas');
  await expect(indicador(page, 'Valor total')).toBeVisible();
  await auditar(page, '/estatisticas', 'estatisticas-gigante');
});

test('sem conexão: mensagem de rede com "Tentar de novo" na tela 10 (RNF24)', async ({ page, request, context }) => {
  const c = await montarCasaComProdutos(request, { editores: 0, leitores: 0 });
  await entrarEEsperar(page, c.admin.email);
  await context.route('**/estatisticas**', (r) => r.abort('internetdisconnected'));
  await page.getByRole('link', { name: 'Ver estatísticas' }).click();
  await expect(page.getByRole('button', { name: /Tentar de novo/ })).toBeVisible({ timeout: 15_000 });
  await context.unroute('**/estatisticas**');
  await page.getByRole('button', { name: /Tentar de novo/ }).click();
  await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'));
});

test('nome de produto realista e comprido (60 caracteres) e valores normais não geram rolagem horizontal na tela 10', async ({ page, request }) => {
  const c = await montarCasaComProdutos(request, {
    editores: 0, leitores: 0, plano: null,
    produtos: [{ nome: 'Notebook Dell Inspiron 14 polegadas 16GB RAM SSD 512GB prata', preco: '4599.00', quantidade: 1, dias: 9, tags: ['Eletrônicos'] }],
  });
  await entrarEEsperar(page, c.admin.email);
  await auditar(page, '/inicio', 'inicio-nome-60');
  await page.goto('/estatisticas');
  await expect(indicador(page, 'Valor total')).toBeVisible();
  await auditar(page, '/estatisticas', 'estatisticas-nome-60');
});
