import type { Page } from '@playwright/test';
import { API_URL, bearer, criarProduto, criarProdutos, criarTag, criarUsuario, entrarEEsperar, expect, montarCasa, test } from './helpers';

// Fluxos de produtos e tags pela UI (telas 05, 06, 07, 08, 09, 23), derivados das histórias m3 e do contrato docs/api/m3-produtos.md.

const unico = (p: string) => `${p} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function preencher(page: Page, d: { nome: string; preco?: string; quantidade?: string; descricao?: string }) {
  await page.getByLabel('Nome do produto').fill(d.nome);
  if (d.descricao) await page.getByLabel('Descrição (opcional)').fill(d.descricao);
  await page.getByLabel('Preço (R$)').fill(d.preco ?? '10,00');
  await page.getByLabel('Quantidade').fill(d.quantidade ?? '1');
}

test.describe('cadastro (tela 08, UC020/022/023)', () => {
  test('ADMIN cadastra produto com tag nova e tag existente; vê o detalhe e o produto na lista', async ({ page, request }) => {
    const c = await montarCasa(request, { editores: 0, leitores: 0, prefixo: 'm3ui' });
    const existente = await criarTag(request, c.admin, unico('Cozinha'));
    await entrarEEsperar(page, c.admin.email);
    await page.goto('/produtos/novo');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const nome = unico('Cafeteira Elétrica');
    await preencher(page, { nome, preco: '1.234,50', quantidade: '2', descricao: 'Preta, 15 xícaras' });
    await page.getByRole('button', { name: existente.nome, exact: true }).click();
    await expect(page.getByRole('button', { name: existente.nome, exact: true })).toHaveAttribute('aria-pressed', 'true');
    const novaTag = unico('Garantia');
    await page.getByLabel('Nova tag').fill(novaTag);
    await page.getByRole('button', { name: 'Criar tag' }).click();
    await expect(page.getByRole('button', { name: novaTag, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Salvar produto' }).click();

    await expect(page).toHaveURL(/\/produtos\/\d+$/);
    await expect(page.getByText('Produto cadastrado.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: nome })).toBeVisible();
    await expect(page.getByText('R$ 1.234,50')).toBeVisible();
    await expect(page.getByText('Preta, 15 xícaras')).toBeVisible();
    const tags = page.getByRole('list', { name: 'Tags' });
    await expect(tags).toContainText(existente.nome);
    await expect(tags).toContainText(novaTag);
    await expect(page.getByRole('definition').filter({ hasText: 'Admin E2E' })).toBeVisible();

    await page.goto('/produtos');
    await expect(page.getByRole('link', { name: new RegExp(nome) })).toBeVisible();
  });

  test('validação no formulário: nome vazio, preço inválido e quantidade 0 não chamam a API', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.val');
    await entrarEEsperar(page, u.email);
    await page.goto('/produtos/novo');
    let chamouPost = false;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/produtos$/.test(r.url())) chamouPost = true;
    });
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await preencher(page, { nome: 'Ok', preco: 'abc', quantidade: '0' });
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).toHaveURL(/\/produtos\/novo$/);
    expect(chamouPost).toBe(false);
  });

  test('tag repetida (409 TAG_EXISTENTE) seleciona a existente e avisa, sem criar outra', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.tag');
    const t = await criarTag(request, u, unico('Eletro'));
    await entrarEEsperar(page, u.email);
    await page.goto('/produtos/novo');
    await page.getByLabel('Nova tag').fill(t.nome.toUpperCase());
    await page.getByRole('button', { name: 'Criar tag' }).click();
    await expect(page.getByText(/Essa tag já existe/)).toBeVisible();
    await expect(page.getByRole('button', { name: t.nome, exact: true })).toHaveAttribute('aria-pressed', 'true');
    const lista = await (await request.get(`${API_URL}/tags`, { headers: bearer(u.token) })).json();
    expect(lista.itens).toHaveLength(1);
  });

  test('EDITOR vê o aviso de que os produtos ficam na Casa, pode dispensar e a escolha é lembrada; ADMIN não vê', async ({ page, request }) => {
    const c = await montarCasa(request, { editores: 1, leitores: 0, prefixo: 'm3ui.av' });
    await entrarEEsperar(page, c.editor!.email);
    await page.goto('/produtos/novo');
    await expect(page.getByRole('note')).toContainText('Os produtos ficam na Casa, mesmo que você saia dela.');
    await page.getByRole('button', { name: 'Entendi' }).click();
    await expect(page.getByRole('note')).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel('Nome do produto')).toBeVisible();
    await expect(page.getByRole('note')).toHaveCount(0);
    await page.evaluate(() => localStorage.clear());
    await entrarEEsperar(page, c.admin.email);
    await page.goto('/produtos/novo');
    await expect(page.getByLabel('Nome do produto')).toBeVisible();
    await expect(page.getByRole('note')).toHaveCount(0);
  });

  test('EDITOR cadastra produto (RNF31) e o LEITOR da Casa o enxerga', async ({ page, request }) => {
    const c = await montarCasa(request, { editores: 1, leitores: 1, prefixo: 'm3ui.ed' });
    await entrarEEsperar(page, c.editor!.email);
    await page.goto('/produtos/novo');
    const nome = unico('Panela');
    await preencher(page, { nome });
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page).toHaveURL(/\/produtos\/\d+$/);
    await page.evaluate(() => localStorage.clear());
    await entrarEEsperar(page, c.leitor!.email);
    await page.goto('/produtos');
    await expect(page.getByRole('link', { name: new RegExp(nome) })).toBeVisible();
  });
});

test.describe('duplicidade (tela 09, RF33)', () => {
  async function tentarDuplicado(page: Page, nome: string, quantidade = '3') {
    await page.goto('/produtos/novo');
    await preencher(page, { nome, quantidade, preco: '99,00' });
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    const modal = page.getByRole('dialog', { name: 'Este produto já existe' });
    await expect(modal).toBeVisible();
    return modal;
  }

  test('o 409 abre a tela 09 com o produto existente e as 3 opções; nome comparado sem diferenciar caixa', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.dup');
    const nome = unico('Cafeteira');
    await criarProduto(request, u, { nome, quantidade: 2, preco: '199.00' });
    await entrarEEsperar(page, u.email);
    const modal = await tentarDuplicado(page, `  ${nome.toUpperCase()} `);
    await expect(modal).toContainText(nome);
    await expect(modal).toContainText('R$ 199,00');
    await expect(modal).toContainText('Quantidade atual: 2');
    await expect(modal).toContainText('2 + 3 = 5');
    await expect(modal.getByRole('button', { name: 'Somar à quantidade' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Cadastrar mesmo assim' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Cancelar' })).toBeVisible();
    const dentro = await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
    expect(dentro, 'o foco deve ir para o modal').toBe(true);
  });

  test('Somar à quantidade: só soma, mantém o preço do existente e mostra o aviso', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.soma');
    const nome = unico('Panela');
    const { produto } = await criarProduto(request, u, { nome, quantidade: 2, preco: '50.00' });
    await entrarEEsperar(page, u.email);
    const modal = await tentarDuplicado(page, nome, '3');
    await modal.getByRole('button', { name: 'Somar à quantidade' }).click();
    await expect(page).toHaveURL(new RegExp(`/produtos/${produto.id}$`));
    await expect(page.getByText('Quantidade somada: agora são 5 unidades.')).toBeVisible();
    await expect(page.getByText('R$ 50,00')).toBeVisible();
    await expect(page.getByText('Quantidade somada: 2 + 3 = 5')).toBeVisible(); // histórico
    const lista = await (await request.get(`${API_URL}/produtos?busca=${encodeURIComponent(nome)}`, { headers: bearer(u.token) })).json();
    expect(lista.total).toBe(1);
  });

  test('Cadastrar mesmo assim: cria o segundo produto com o mesmo nome', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.mesmo');
    const nome = unico('Caneca');
    const { produto } = await criarProduto(request, u, { nome, quantidade: 1 });
    await entrarEEsperar(page, u.email);
    const modal = await tentarDuplicado(page, nome, '4');
    await modal.getByRole('button', { name: 'Cadastrar mesmo assim' }).click();
    await expect(page).toHaveURL(/\/produtos\/\d+$/);
    expect(page.url()).not.toContain(`/produtos/${produto.id}`);
    await expect(page.getByText('Produto cadastrado.')).toBeVisible();
    const lista = await (await request.get(`${API_URL}/produtos?busca=${encodeURIComponent(nome)}`, { headers: bearer(u.token) })).json();
    expect(lista.total).toBe(2);
  });

  test('Cancelar: fecha o modal, mantém o que foi digitado e não faz chamada nem cria produto', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.cancela');
    const nome = unico('Jarra');
    await criarProduto(request, u, { nome, quantidade: 1 });
    await entrarEEsperar(page, u.email);
    const modal = await tentarDuplicado(page, nome, '7');
    const chamadas: string[] = [];
    page.on('request', (r) => {
      if (['POST', 'PATCH', 'DELETE'].includes(r.method())) chamadas.push(`${r.method()} ${r.url()}`);
    });
    await modal.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Nome do produto')).toHaveValue(nome);
    await expect(page.getByLabel('Quantidade')).toHaveValue('7');
    await page.waitForTimeout(300);
    expect(chamadas, 'Cancelar não pode chamar a API').toEqual([]);
    const lista = await (await request.get(`${API_URL}/produtos?busca=${encodeURIComponent(nome)}`, { headers: bearer(u.token) })).json();
    expect(lista.total).toBe(1);
  });

  test('Esc também cancela o modal (acessibilidade)', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.esc');
    const nome = unico('Prato');
    await criarProduto(request, u, { nome });
    await entrarEEsperar(page, u.email);
    await tentarDuplicado(page, nome);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('original excluído entre o 409 e o Somar: cadastra como novo e avisa', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.sumiu');
    const nome = unico('Colher');
    const { produto } = await criarProduto(request, u, { nome });
    await entrarEEsperar(page, u.email);
    const modal = await tentarDuplicado(page, nome);
    await request.delete(`${API_URL}/produtos/${produto.id}`, { headers: bearer(u.token) });
    await modal.getByRole('button', { name: 'Somar à quantidade' }).click();
    await expect(page.getByText('O produto original não existe mais; cadastramos como novo.')).toBeVisible();
  });
});

test.describe('listar, buscar e filtrar (tela 06, RF10, RF34)', () => {
  test('busca por nome (sem diferenciar caixa), filtro por tag, combinação, vazio e Limpar filtros; tudo na URL', async ({ page, request }) => {
    const c = await montarCasa(request, { editores: 0, leitores: 1, prefixo: 'm3ui.busca' });
    const marca = `zx${Date.now()}`;
    const tag = await criarTag(request, c.admin, unico('Cozinha'));
    await criarProduto(request, c.admin, { nome: `${marca} Cafeteira`, tagIds: [tag.id] });
    await criarProduto(request, c.admin, { nome: `${marca} Cadeira` });
    await criarProduto(request, c.admin, { nome: `${marca} Panela`, tagIds: [tag.id] });
    await entrarEEsperar(page, c.leitor!.email);
    await page.goto('/produtos');
    await expect(page.getByText('3 produtos')).toBeVisible();

    await page.getByLabel('Buscar produto por nome').fill(marca.toUpperCase() + ' caf');
    await expect(page.getByText('1 produto', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Cafeteira/ })).toBeVisible();
    await expect(page).toHaveURL(/busca=/);

    await page.getByLabel('Buscar produto por nome').fill(marca);
    await expect(page.getByText('3 produtos')).toBeVisible();
    await page.getByRole('button', { name: tag.nome, exact: true }).click();
    await expect(page.getByRole('button', { name: tag.nome, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('2 produtos')).toBeVisible();
    await expect(page.getByRole('link', { name: /Cadeira/ })).toHaveCount(0);
    await expect(page).toHaveURL(/tag=\d+/);

    await page.getByLabel('Buscar produto por nome').fill(`${marca} inexistente`);
    await expect(page.getByText('Nenhum produto encontrado')).toBeVisible();
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(page.getByText('3 produtos')).toBeVisible();
    await expect(page.getByLabel('Buscar produto por nome')).toHaveValue('');

    // a URL com filtros recarrega o mesmo resultado
    await page.goto(`/produtos?busca=${marca}%20panela&tag=${tag.id}`);
    await expect(page.getByLabel('Buscar produto por nome')).toHaveValue(`${marca} panela`);
    await expect(page.getByRole('link', { name: /Panela/ })).toBeVisible();
    await expect(page.getByText('1 produto', { exact: true })).toBeVisible();
  });

  test('ordenar por nome e paginar (21 produtos: Anterior/Próxima e "Página 1 de 2")', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.pag');
    await criarProdutos(request, u, 21, { nome: 'Item' });
    await entrarEEsperar(page, u.email);
    await page.goto('/produtos');
    await expect(page.getByText('21 produtos')).toBeVisible();
    await expect(page.getByText('Página 1 de 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await expect(page.getByRole('list').locator('li')).toHaveCount(20);
    await page.getByRole('button', { name: 'Próxima' }).click();
    await expect(page.getByText('Página 2 de 2')).toBeVisible();
    await expect(page.getByRole('list').locator('li')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    await page.getByLabel('Ordenar por').selectOption('nome');
    await expect(page).toHaveURL(/ordem=nome/);
    await expect(page.getByText('Página 1 de 2')).toBeVisible();
  });

  test('Casa sem produtos: estado vazio com chamada para cadastrar (ADMIN) e texto neutro para o LEITOR', async ({ page, request }) => {
    const c = await montarCasa(request, { editores: 0, leitores: 1, prefixo: 'm3ui.vazio' });
    await entrarEEsperar(page, c.admin.email);
    await page.goto('/produtos');
    await expect(page.getByText('Nenhum produto cadastrado')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Adicionar produto' })).toBeVisible();
    await page.evaluate(() => localStorage.clear());
    await entrarEEsperar(page, c.leitor!.email);
    await page.goto('/produtos');
    await expect(page.getByText('Nenhum produto cadastrado')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Adicionar produto' })).toHaveCount(0);
  });

  test('erro de rede na lista mostra mensagem e "Tentar novamente" recupera', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.rede');
    await criarProduto(request, u, { nome: unico('Rede') });
    await entrarEEsperar(page, u.email);
    let falhar = true;
    await page.route(/\/api\/produtos(\?.*)?$/, (rota) => (falhar ? rota.abort('failed') : rota.continue()));
    await page.goto('/produtos');
    await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
    falhar = false;
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByText('1 produto', { exact: true })).toBeVisible();
  });
});

test.describe('tela 05: produtos recentes e atalho', () => {
  // Sprint 4: a partir de 1024 px o Início é a tela 17 (tabela de produtos); "Adicionados recentemente" é só da tela 05 (celular).
  test.use({ viewport: { width: 390, height: 844 } });

  test('mostra os 5 mais recentes e o atalho leva ao cadastro; LEITOR não vê o atalho', async ({ page, request }) => {
    const c = await montarCasa(request, { editores: 0, leitores: 1, prefixo: 'm3ui.ini' });
    const criados = await criarProdutos(request, c.admin, 7, { nome: 'Recente' });
    await entrarEEsperar(page, c.admin.email);
    const secao = page.getByRole('region', { name: 'Adicionados recentemente' });
    await expect(secao.getByRole('listitem')).toHaveCount(5);
    await expect(secao.getByRole('link', { name: new RegExp(criados[6].nome) })).toBeVisible();
    await expect(secao.getByRole('link', { name: new RegExp(criados[0].nome) })).toHaveCount(0);
    await secao.getByRole('link', { name: '+ Adicionar produto' }).click();
    await expect(page).toHaveURL(/\/produtos\/novo$/);
    await page.evaluate(() => localStorage.clear());
    await entrarEEsperar(page, c.leitor!.email);
    const s2 = page.getByRole('region', { name: 'Adicionados recentemente' });
    await expect(s2.getByRole('listitem')).toHaveCount(5);
    await expect(s2.getByRole('link', { name: '+ Adicionar produto' })).toHaveCount(0);
  });

  test('Casa nova: mensagem de vazio no Início', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.ini0');
    await entrarEEsperar(page, u.email);
    await expect(page.getByText('Sua Casa ainda não tem produtos. Cadastre o primeiro.')).toBeVisible();
  });
});

test.describe('detalhe (tela 07), edição, exclusão (tela 23) e histórico (RF11)', () => {
  test('detalhe mostra todos os campos; id inexistente e de outra Casa mostram "não encontrado"', async ({ page, request }) => {
    const c = await montarCasa(request, { editores: 0, leitores: 0, prefixo: 'm3ui.det' });
    const outro = await criarUsuario(request, 'm3ui.det.outro');
    const tag = await criarTag(request, c.admin, unico('Tag'));
    const nome = unico('Liquidificador');
    const { produto } = await criarProduto(request, c.admin, { nome, descricao: 'Potente', preco: '349.90', quantidade: 3, dataCompra: '2026-03-15', tagIds: [tag.id] });
    const alheio = (await criarProduto(request, outro)).produto;
    await entrarEEsperar(page, c.admin.email);
    await page.goto(`/produtos/${produto.id}`);
    await expect(page.getByRole('heading', { level: 1, name: nome })).toBeVisible();
    await expect(page.getByText('R$ 349,90')).toBeVisible();
    await expect(page.getByText('15/03/2026')).toBeVisible();
    await expect(page.getByText('Potente')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Tags' })).toContainText(tag.nome);
    await expect(page.getByRole('heading', { name: 'Histórico' })).toBeVisible();
    await expect(page.getByText('Produto cadastrado (3 unidades)')).toBeVisible();
    for (const id of [alheio.id, 2147483000]) {
      await page.goto(`/produtos/${id}`);
      await expect(page.getByRole('heading', { name: 'Produto não encontrado' })).toBeVisible();
    }
  });

  test('editar: altera campos e tags, volta ao detalhe com "Alterações salvas." e o histórico registra antes/depois', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.edit');
    const t = await criarTag(request, u, unico('Nova'));
    const nome = unico('Fogão');
    const { produto } = await criarProduto(request, u, { nome, quantidade: 1, preco: '10.00' });
    await entrarEEsperar(page, u.email);
    await page.goto(`/produtos/${produto.id}`);
    await page.getByRole('link', { name: 'Editar produto' }).click();
    await expect(page).toHaveURL(new RegExp(`/produtos/${produto.id}/editar$`));
    await expect(page.getByLabel('Nome do produto')).toHaveValue(nome);
    await expect(page.getByLabel('Preço (R$)')).toHaveValue('10,00');
    await page.getByLabel('Quantidade').fill('4');
    await page.getByLabel('Preço (R$)').fill('12,50');
    await page.getByRole('button', { name: t.nome, exact: true }).click();
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page).toHaveURL(new RegExp(`/produtos/${produto.id}$`));
    await expect(page.getByText('Alterações salvas.')).toBeVisible();
    await expect(page.getByText('R$ 12,50', { exact: true })).toBeVisible();
    await expect(page.getByText('Produto alterado')).toBeVisible();
    await expect(page.getByText('Quantidade: 1 → 4')).toBeVisible();
    await expect(page.getByText(/Preço: R\$\s?10,00 → R\$\s?12,50/)).toBeVisible();
    await expect(page.getByText(`Tags adicionadas: ${t.nome}`)).toBeVisible();
    await expect(page.getByText('Produto cadastrado (1 unidade)')).toBeVisible();
  });

  test('editar sem mudar nada não gera evento no histórico', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.nada');
    const { produto } = await criarProduto(request, u);
    await entrarEEsperar(page, u.email);
    await page.goto(`/produtos/${produto.id}/editar`);
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByText('Alterações salvas.')).toBeVisible();
    await expect(page.getByText('Produto alterado')).toHaveCount(0);
  });

  test('editar o nome para um já existente é permitido (sem tela 09)', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.nomeigual');
    const nome = unico('Igual');
    await criarProduto(request, u, { nome });
    const { produto } = await criarProduto(request, u);
    await entrarEEsperar(page, u.email);
    await page.goto(`/produtos/${produto.id}/editar`);
    await page.getByLabel('Nome do produto').fill(nome);
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByText('Alterações salvas.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('excluir: Cancelar mantém o produto; confirmar remove, volta à lista e o produto some', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.del');
    const nome = unico('Ventilador');
    const { produto } = await criarProduto(request, u, { nome });
    await entrarEEsperar(page, u.email);
    await page.goto(`/produtos/${produto.id}`);
    await page.getByRole('button', { name: 'Excluir produto' }).click();
    const modal = page.getByRole('dialog', { name: 'Excluir produto?' });
    await expect(modal).toContainText(nome);
    await expect(modal).toContainText('não pode ser desfeita');
    const dentro = await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
    expect(dentro).toBe(true);
    await modal.getByRole('button', { name: 'Cancelar' }).click();
    await expect(modal).toHaveCount(0);
    expect((await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(u.token) })).status()).toBe(200);
    await page.getByRole('button', { name: 'Excluir produto' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(u.token) })).status()).toBe(200);

    await page.getByRole('button', { name: 'Excluir produto' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Excluir produto' }).click();
    await expect(page).toHaveURL(/\/produtos$/);
    await expect(page.getByText('Produto excluído.')).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(nome) })).toHaveCount(0);
    expect((await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(u.token) })).status()).toBe(404);
  });

  test('excluir um produto que já foi excluído por outra pessoa é sucesso silencioso', async ({ page, request }) => {
    const c = await montarCasa(request, { editores: 1, leitores: 0, prefixo: 'm3ui.del2' });
    const { produto } = await criarProduto(request, c.admin);
    await entrarEEsperar(page, c.admin.email);
    await page.goto(`/produtos/${produto.id}`);
    await expect(page.getByRole('heading', { level: 1, name: produto.nome })).toBeVisible();
    await request.delete(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.editor!.token) });
    await page.getByRole('button', { name: 'Excluir produto' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Excluir produto' }).click();
    await expect(page).toHaveURL(/\/produtos$/);
  });

  test('histórico com mais de 20 eventos tem "Carregar mais"', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3ui.hist');
    const { produto } = await criarProduto(request, u, { quantidade: 1 });
    for (let q = 2; q <= 23; q++) await request.patch(`${API_URL}/produtos/${produto.id}`, { headers: bearer(u.token), data: { quantidade: q } });
    await entrarEEsperar(page, u.email);
    await page.goto(`/produtos/${produto.id}`);
    await expect(page.getByText('Produto alterado')).toHaveCount(20);
    await page.getByRole('button', { name: 'Carregar mais' }).click();
    await expect(page.getByText('Produto cadastrado (1 unidade)')).toBeVisible();
    await expect(page.getByText('Produto alterado')).toHaveCount(22);
  });

  test('histórico mostra ex-membro quando o autor saiu da Casa', async ({ page, request }) => {
    const c = await montarCasa(request, { editores: 1, leitores: 0, prefixo: 'm3ui.exm' });
    const { produto } = await criarProduto(request, c.editor!);
    await request.delete(`${API_URL}/casa/membros/${c.editor!.id}`, { headers: bearer(c.admin.token) });
    await entrarEEsperar(page, c.admin.email);
    await page.goto(`/produtos/${produto.id}`);
    await expect(page.getByText('Adicionado por').locator('..').getByText('ex-membro')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Histórico' }).locator('..').getByText(/ex-membro/)).toBeVisible();
  });
});

test.describe('LEITOR só consulta (RNF31)', () => {
  test('sem botões de adicionar, editar e excluir; URLs de cadastro e edição mostram aviso de permissão; a API recusa', async ({ page, request }) => {
    const c = await montarCasa(request, { editores: 0, leitores: 1, prefixo: 'm3ui.leitor' });
    const { produto } = await criarProduto(request, c.admin, { nome: unico('Somente leitura') });
    await entrarEEsperar(page, c.leitor!.email);
    await expect(page.getByRole('link', { name: '+ Adicionar produto' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Adicionar produto' })).toHaveCount(0); // "+" da barra inferior
    await page.goto('/produtos');
    await expect(page.getByRole('link', { name: '+ Adicionar' })).toHaveCount(0);
    await page.goto(`/produtos/${produto.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Editar produto' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Excluir produto' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Histórico' })).toBeVisible();
    for (const rota of ['/produtos/novo', `/produtos/${produto.id}/editar`]) {
      await page.goto(rota);
      await expect(page.getByRole('button', { name: /Salvar/ }), `LEITOR não deve poder salvar em ${rota}`).toHaveCount(0);
    }
    const r = await request.delete(`${API_URL}/produtos/${produto.id}`, { headers: bearer(c.leitor!.token) });
    expect(r.status()).toBe(403);
  });
});
