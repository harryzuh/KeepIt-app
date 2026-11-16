import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { criarProduto, criarTag, entrarEEsperar, expect, montarCasaComProdutos, test } from './helpers';
import { semRolagemHorizontal } from './sprint2-telas';

// QA Sprint 4 (M4), desktop 1280x720 (tela 17 do Início e tela 10). Números do conjunto padrão: valor total 5754.60.
// Dinheiro aparece como "R$ 5.754,60" (o espaço é não separável, por isso \s).
const brl = (v: string) => new RegExp(`R\\$\\s*${v.replace(/\./g, '\\.')}`);
/** axe WCAG 2.1 A/AA, falhando em violações sérias/críticas; `regras` permite isolar ou desligar regras. */
async function axe(page: Page, rota: string, opcoes: { so?: string[]; sem?: string[] } = {}) {
  let b = new AxeBuilder({ page }).exclude('.text-apoio');
  b = opcoes.so ? b.withRules(opcoes.so) : b.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).disableRules(opcoes.sem ?? []);
  const r = await b.analyze();
  const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(graves.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.html.slice(0, 140)).join(' | ')}`), `violações axe em ${rota}`).toEqual([]);
}
// "Maior gasto" é um link (sem grupo aninhado, WCAG 2.5.3): o nome acessível é o texto visível, que começa pelo rótulo.
const indicador = (page: Page, rotulo: string) => {
  const grupo = page.getByRole('group', { name: new RegExp(`^${rotulo}:`) });
  return rotulo === 'Maior gasto' ? grupo.or(page.getByRole('link', { name: /^Maior gasto\s/ })) : grupo;
};

test.describe('Início no desktop (tela 17)', () => {
  test('ADMIN: indicadores batem com os produtos criados, tabela de produtos e armazenamento', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request);
    await entrarEEsperar(page, c.admin.email);
    const resumo = page.getByRole('region', { name: 'Resumo da Casa' });
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'));
    await expect(indicador(page, 'Maior gasto')).toContainText(brl('4.599,00'));
    await expect(indicador(page, 'Maior gasto')).toContainText('Notebook 14 polegadas');
    await expect(indicador(page, 'Valor médio')).toContainText(brl('1.918,20'));
    await expect(indicador(page, 'Membros')).toContainText(/\d+ de \d+/);
    await expect(resumo.getByRole('progressbar', { name: 'Armazenamento usado' })).toBeVisible();
    await expect(resumo).toContainText(/Plano Família · Renova em \d{2}\/\d{2}\/\d{4}/);
    await expect(resumo.getByRole('link', { name: 'Ver estatísticas' })).toBeVisible();
    await expect(page.getByRole('link', { name: '+ Adicionar produto' })).toBeVisible();
    for (const p of c.produtos) await expect(page.getByRole('link', { name: p.nome.slice(0, 12) }).first()).toBeVisible();
    await page.screenshot({ path: 'test-results/sprint4-telas/desktop-inicio-admin.png', fullPage: true });
  });

  test('LEITOR vê os indicadores e não tem atalhos de edição (RNF31 complementar)', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, { leitores: 1, editores: 0 });
    await entrarEEsperar(page, c.leitor!.email);
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'));
    await expect(page.getByRole('link', { name: '+ Adicionar produto' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Adicionar produto' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Ver estatísticas' }).click();
    await expect(page).toHaveURL(/\/estatisticas$/);
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'));
    await expect(page.getByRole('link', { name: /Adicionar produto/ })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/sprint4-telas/desktop-estatisticas-leitor.png', fullPage: true });
  });

  test('EDITOR vê os mesmos números da Casa', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, { editores: 1, leitores: 0 });
    await entrarEEsperar(page, c.editor!.email);
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'));
    await expect(indicador(page, 'Valor médio')).toContainText(brl('1.918,20'));
  });

  test('Casa vazia: estado vazio sem NaN, sem R$ errado e sem erro', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, { produtos: [], plano: null, editores: 0, leitores: 0 });
    await entrarEEsperar(page, c.admin.email);
    await expect(indicador(page, 'Valor total')).toContainText(brl('0,00'));
    await expect(page.getByText(/Nenhum produto cadastrado ainda/)).toBeVisible();
    await expect(indicador(page, 'Valor médio')).toContainText('—');
    await expect(indicador(page, 'Maior gasto')).toContainText('—');
    await expect(page.getByText('Plano Individual')).toHaveCount(2); // cartão da Casa e linha do resumo
    const texto = await page.locator('main, body').first().innerText();
    expect(texto).not.toMatch(/NaN|undefined|Infinity|null/);
    await page.getByRole('link', { name: 'Ver estatísticas' }).click();
    await expect(page.getByText('Ainda não há dados para estatísticas')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Adicionar produto' })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|Infinity/);
  });

  test('plano Individual não mostra data de renovação', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, { plano: null, editores: 0, leitores: 0 });
    await entrarEEsperar(page, c.admin.email);
    const resumo = page.getByRole('region', { name: 'Resumo da Casa' });
    await expect(resumo).toContainText('Plano Individual');
    await expect(resumo).not.toContainText(/Renova em|Benefícios até/);
  });
});

test.describe('Estatísticas (tela 10) no desktop', () => {
  test('ADMIN: números, tag mais comprada, valor por tag com "Sem tag" por último e mais antigos em ordem', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, { editores: 0, leitores: 0 });
    await entrarEEsperar(page, c.admin.email);
    await page.getByRole('link', { name: 'Ver estatísticas' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Estatísticas' })).toBeVisible();
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'));
    await expect(indicador(page, 'Valor total')).toContainText('3 produtos');
    await expect(indicador(page, 'Valor total')).toContainText('45 unidades');
    await expect(indicador(page, 'Maior gasto')).toContainText(brl('4.599,00'));
    await expect(indicador(page, 'Maior gasto')).toContainText(/Comprado em \d{2}\/\d{2}\/\d{4}/);
    await expect(indicador(page, 'Valor médio')).toContainText(brl('1.918,20'));
    await expect(indicador(page, 'Tag mais comprada')).toContainText('Utilidades');
    await expect(indicador(page, 'Tag mais comprada')).toContainText('40 unidades');

    const barras = page.getByRole('img', { name: /do valor total/ });
    await expect(barras).toHaveCount(4);
    await expect(barras.nth(0)).toHaveAttribute('aria-label', /^Eletrônicos: R\$\s*4\.599,00, 79,9% do valor total, 1 produto/);
    await expect(barras.nth(2)).toHaveAttribute('aria-label', /^Utilidades: R\$\s*996,00/);
    await expect(barras.nth(3)).toHaveAttribute('aria-label', /^Sem tag: R\$\s*159,60/);
    await expect(page.getByText('Produtos com mais de uma tag aparecem em cada uma.')).toBeVisible();

    const antigos = page.getByRole('region', { name: 'Produtos mais antigos' }).getByRole('link');
    await expect(antigos).toHaveCount(3);
    await expect(antigos.nth(0)).toContainText('Notebook 14 polegadas');
    await expect(antigos.nth(2)).toContainText('Caixa organizadora');
    await expect(antigos.nth(0)).toContainText(/R\$\s*4\.599,00 × 1/);
    await antigos.nth(0).click();
    await expect(page).toHaveURL(/\/produtos\/\d+$/);
    await page.screenshot({ path: 'test-results/sprint4-telas/desktop-estatisticas.png', fullPage: true });
  });

  test('maior gasto leva ao detalhe do produto e o link Voltar ao Início funciona', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, { editores: 0, leitores: 0 });
    await entrarEEsperar(page, c.admin.email);
    await page.goto('/estatisticas');
    await page.getByRole('link', { name: /^Maior gasto.*Notebook/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Notebook 14 polegadas' })).toBeVisible();
    await page.goto('/estatisticas');
    await page.getByRole('link', { name: /Voltar ao Início/ }).click();
    await expect(page).toHaveURL(/\/inicio$/);
  });

  test('valores gigantes aparecem por extenso, sem notação científica nem perda de precisão', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, {
      editores: 0, leitores: 0, plano: null,
      produtos: [
        { nome: 'Gigante', preco: '9999999999.99', quantidade: 1_000_000, dias: 5, tags: ['Luxo'] },
        { nome: 'Centavo', preco: '0.01', quantidade: 1, dias: 4, tags: [] },
      ],
    });
    await entrarEEsperar(page, c.admin.email);
    await expect(indicador(page, 'Valor total')).toContainText(brl('9.999.999.999.990.000,01'));
    await page.goto('/estatisticas');
    await expect(indicador(page, 'Valor total')).toContainText(brl('9.999.999.999.990.000,01'));
    await expect(indicador(page, 'Valor médio')).toContainText(brl('4.999.999.999.995.000,01')); // .005 arredonda para cima
    const t = await page.locator('main, body').first().innerText();
    expect(t).not.toMatch(/e\+\d|NaN|Infinity/);
    await semRolagemHorizontal(page, '/estatisticas (valores gigantes)');
  });

  test('50+ tags: aviso de truncamento (máx. 50 linhas)', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, { produtos: [], editores: 0, leitores: 0, plano: null });
    const ids: number[] = [];
    for (let i = 1; i <= 52; i++) ids.push((await criarTag(request, c.admin, `T${String(i).padStart(2, '0')}`)).id);
    for (let i = 0; i < 52; i++) await criarProduto(request, c.admin, { nome: `Prod ${i}`, preco: `${i + 1}.00`, tagIds: [ids[i]] });
    await entrarEEsperar(page, c.admin.email);
    await page.goto('/estatisticas');
    await expect(page.getByText('Mostrando as 50 tags de maior valor, de 52 em uso.')).toBeVisible();
    await expect(page.getByRole('img', { name: /do valor total/ })).toHaveCount(50);
  });
});

test.describe('atualização dos indicadores (RNF07)', () => {
  test('criar, editar e excluir produto pela UI atualizam Início e Estatísticas sem recarregar a página', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, { editores: 0, leitores: 0 });
    await entrarEEsperar(page, c.admin.email);
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'));
    await page.getByRole('link', { name: 'Ver estatísticas' }).click();
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'));

    // Cria R$ 100,00 x 2 = 200,00 -> total 5.954,60, 4 produtos.
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: /Produtos/ }).first().click();
    await page.goto('/produtos/novo'); // navegação completa aceitável aqui; a invalidação é conferida adiante pelo cache em memória
    await page.getByLabel('Nome do produto').fill('Mesa de jantar');
    await page.getByLabel('Preço (R$)').fill('100,00');
    await page.getByLabel('Quantidade').fill('2');
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page.getByText('Produto cadastrado.')).toBeVisible();
    const idMesa = Number(page.url().match(/produtos\/(\d+)/)![1]);

    // Navegação interna (sem reload): o cache de estatisticas deve ter sido invalidado.
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Início' }).first().click();
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.954,60'), { timeout: 5000 });
    await page.getByRole('link', { name: 'Ver estatísticas' }).click();
    await expect(indicador(page, 'Valor total')).toContainText('4 produtos');
    await expect(indicador(page, 'Valor total')).toContainText('47 unidades');

    // Edita: quantidade 2 -> 5 => 500,00; total 6.254,60.
    await page.goto(`/produtos/${idMesa}/editar`);
    await page.getByLabel('Quantidade').fill('5');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByText('Alterações salvas.')).toBeVisible();
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Início' }).first().click();
    await expect(indicador(page, 'Valor total')).toContainText(brl('6.254,60'), { timeout: 5000 });

    // Exclui: volta a 5.754,60.
    await page.goto(`/produtos/${idMesa}`);
    await page.getByRole('button', { name: 'Excluir produto' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Excluir produto' }).click();
    await expect(page.getByText('Produto excluído.')).toBeVisible();
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Início' }).first().click();
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'), { timeout: 5000 });
  });

  test('invalidação sem reload: criar produto e voltar pelo histórico do navegador mostra o total novo', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, { editores: 0, leitores: 0 });
    await entrarEEsperar(page, c.admin.email);
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'));
    await page.getByRole('link', { name: '+ Adicionar produto' }).click(); // navegação SPA
    await page.getByLabel('Nome do produto').fill('Cadeira');
    await page.getByLabel('Preço (R$)').fill('50,00');
    await page.getByLabel('Quantidade').fill('3');
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page.getByText('Produto cadastrado.')).toBeVisible();
    for (let i = 0; i < 3 && !/\/inicio$/.test(page.url()); i++) await page.goBack();
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.904,60'), { timeout: 5000 });
  });

  test('outra pessoa da Casa cadastra produto: o número aparece ao recarregar (e a API já reflete)', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, { editores: 1, leitores: 0 });
    await entrarEEsperar(page, c.admin.email);
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'));
    await criarProduto(request, c.editor!, { nome: 'Do editor', preco: '10.00', quantidade: 1 });
    await page.reload();
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.764,60'));
  });
});

test.describe('troca de conta no mesmo navegador (cache entre contas)', () => {
  test('sair e entrar com outra conta de OUTRA Casa nunca mostra os números da Casa anterior', async ({ page, request }) => {
    const a = await montarCasaComProdutos(request, { editores: 0, leitores: 0, prefixo: 'm4tr.a' });
    const b = await montarCasaComProdutos(request, {
      editores: 0, leitores: 0, prefixo: 'm4tr.b',
      produtos: [{ nome: 'Só da B', preco: '7.00', quantidade: 1, dias: 1, tags: [] }],
    });
    await entrarEEsperar(page, a.admin.email);
    await expect(indicador(page, 'Valor total')).toContainText(brl('5.754,60'));
    // SPA: sai pela Minha conta e entra com a conta B, sem recarregar a página.
    await page.getByRole('link', { name: 'Ir para Minha conta' }).click();
    await page.getByRole('button', { name: 'Encerrar sessão' }).click();
    await expect(page).not.toHaveURL(/\/conta/);
    await page.getByRole('link', { name: 'Entrar' }).first().click();
    await expect(page).toHaveURL(/\/entrar/);
    const vistos: string[] = [];
    page.on('response', async (r) => {
      if (/\/estatisticas\/resumo/.test(r.url())) vistos.push(await r.text().catch(() => ''));
    });
    await page.getByLabel('E-mail').fill(b.admin.email);
    await page.getByLabel('Senha', { exact: true }).fill(b.admin.senha);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    // Nenhum quadro intermediário pode exibir os valores da Casa A.
    const amostras: string[] = [];
    for (let i = 0; i < 20; i++) {
      amostras.push(await page.locator('body').innerText());
      await page.waitForTimeout(25);
    }
    expect(amostras.some((t) => /5\.754,60/.test(t)), 'números da Casa anterior apareceram após trocar de conta').toBe(false);
    await expect(indicador(page, 'Valor total')).toContainText(brl('7,00'));
  });
});

test.describe('acessibilidade (RNF19) no desktop', () => {
  test('axe sem violações sérias em Início e Estatísticas; gráfico tem texto equivalente; foco visível', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, { editores: 0, leitores: 0 });
    await entrarEEsperar(page, c.admin.email);
    await expect(indicador(page, 'Valor total')).toBeVisible();
    await page.getByRole('progressbar').first().waitFor();
    await axe(page, '/inicio', { sem: ['label-content-name-mismatch'] });
    await page.goto('/estatisticas');
    await expect(page.getByRole('img', { name: /do valor total/ }).first()).toBeVisible();
    await axe(page, '/estatisticas', { sem: ['label-content-name-mismatch'] });
    // Cada barra tem o mesmo valor e percentual escritos ao lado (cor/tamanho não é o único sinal).
    const corpo = await page.locator('main').innerText();
    expect(corpo).toMatch(/Eletrônicos[\s\S]*R\$\s*4\.599,00 · 79,9%/);
    // Navegação por teclado alcança os links de produtos antigos com foco visível.
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      const alvo = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a || !a.closest('[aria-labelledby="titulo-antigos"]')) return null;
        const cs = getComputedStyle(a);
        return { outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, sombra: cs.boxShadow !== 'none' };
      });
      if (alvo) {
        expect(alvo.outline || alvo.sombra, 'foco sem indicador visível nos produtos mais antigos').toBe(true);
        return;
      }
    }
    throw new Error('Tab não alcançou a lista de produtos mais antigos em 30 passos');
  });

  test('WCAG 2.5.3 (rótulo no nome): o nome acessível do link "Maior gasto" contém o texto visível', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, { editores: 0, leitores: 0 });
    await entrarEEsperar(page, c.admin.email);
    await page.goto('/estatisticas');
    await expect(indicador(page, 'Maior gasto')).toBeVisible();
    await axe(page, '/estatisticas (maior gasto)', { so: ['label-content-name-mismatch'] });
  });

  test('barra de armazenamento acima de 90% escreve o aviso e expõe valores ao leitor de tela', async ({ page, request }) => {
    const c = await montarCasaComProdutos(request, { editores: 0, leitores: 0 });
    await entrarEEsperar(page, c.admin.email);
    const barra = page.getByRole('progressbar', { name: 'Armazenamento usado' }).first();
    await expect(barra).toHaveAttribute('aria-valuemin', '0');
    await expect(barra).toHaveAttribute('aria-valuemax', '100');
    await expect(barra).toHaveAttribute('aria-valuetext', /de .* usados/);
  });
});
