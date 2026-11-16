import type { Page } from '@playwright/test';
import { API_URL, bearer, criarProduto, criarUsuario, entrarEEsperar, expect, FOTOS, montarCasa, test } from './helpers';
import { ocuparArmazenamento } from './m3-db';

// Fotos pela UI (tela 08 e 07): upload por URL assinada direto ao S3 (via proxy /s3), limites, tipo real e cota (RF05, RF39, RNF08, RNF09).

const unico = (p: string) => `${p} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const entrada = (page: Page) => page.getByTestId('entrada-fotos');

async function abrirCadastro(page: Page, nome: string) {
  await page.goto('/produtos/novo');
  await page.getByLabel('Nome do produto').fill(nome);
  await page.getByLabel('Preço (R$)').fill('10,00');
}

/** Espera a miniatura n carregar de verdade (naturalWidth > 0). */
async function imagensCarregadas(page: Page, seletor: string, quantidade: number) {
  await expect
    .poll(async () => page.$$eval(seletor, (imgs) => imgs.filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0).length), { timeout: 15_000 })
    .toBe(quantidade);
}

test.describe('cadastro com fotos', () => {
  test('1 foto JPEG: envia, mostra prévia, salva e o detalhe exibe a imagem carregada do S3 com alt', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.um');
    await entrarEEsperar(page, u.email);
    const nome = unico('Liquidificador');
    await abrirCadastro(page, nome);
    await entrada(page).setInputFiles(FOTOS.jpeg.arquivo);
    await expect(page.getByText(/Enviada ·/)).toBeVisible();
    await expect(page.getByAltText(`Prévia da foto 1 de ${nome}`)).toBeVisible();
    await expect(page.getByText('Capa', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page).toHaveURL(/\/produtos\/\d+$/);
    const foto = page.getByAltText(`Foto de ${nome} (foto 1 de 1)`).or(page.getByRole('img', { name: new RegExp(`${nome}.*foto 1 de 1`) }));
    await expect(foto.first()).toBeVisible();
    await imagensCarregadas(page, 'ul[aria-label="Fotos do produto"] img', 1);
    // a imagem vem por URL assinada (GET) e passa pelo proxy /s3
    const src = await page.locator('ul[aria-label="Fotos do produto"] img').first().getAttribute('src');
    expect(src).toContain('/s3/');
    expect(src).toContain('X-Amz-Signature');
  });

  test('3 fotos (JPEG, PNG e PNG renomeado como .jpg): todas aceitas, ordem preservada, 4ª bloqueada', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.tres');
    await entrarEEsperar(page, u.email);
    const nome = unico('Bicicleta');
    await abrirCadastro(page, nome);
    await entrada(page).setInputFiles([FOTOS.jpeg.arquivo, FOTOS.png.arquivo, FOTOS.pngRenomeado.arquivo]);
    await expect(page.getByText(/Enviada ·/)).toHaveCount(3);
    const botao = page.getByRole('button', { name: 'Limite de 3 fotos atingido' });
    await expect(botao).toBeVisible();
    await expect(botao).toBeDisabled();
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page).toHaveURL(/\/produtos\/\d+$/);
    await imagensCarregadas(page, 'ul[aria-label="Fotos do produto"] img', 3);
    const id = Number(page.url().split('/').pop());
    const det = await (await request.get(`${API_URL}/produtos/${id}`, { headers: bearer(u.token) })).json();
    expect(det.fotos.map((f: any) => f.tipo)).toEqual(['JPEG', 'PNG', 'PNG']); // o PNG renomeado vale pelo tipo real
  });

  test('escolher 4 arquivos de uma vez: só 3 entram e aparece o aviso de limite', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.quatro');
    await entrarEEsperar(page, u.email);
    await abrirCadastro(page, unico('Quatro'));
    await entrada(page).setInputFiles([FOTOS.jpeg.arquivo, FOTOS.png.arquivo, FOTOS.pngRenomeado.arquivo, FOTOS.jpeg.arquivo]);
    await expect(page.getByText(/Enviada ·/)).toHaveCount(3);
    await expect(page.getByText('Um produto aceita até 3 fotos.')).toBeVisible();
    await expect(page.locator('img[alt^="Prévia da foto"]')).toHaveCount(3);
  });

  test('4ª foto em seleção separada: botão desabilitado e nenhuma chamada upload-url', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.quarta');
    await entrarEEsperar(page, u.email);
    await abrirCadastro(page, unico('Quarta'));
    await entrada(page).setInputFiles([FOTOS.jpeg.arquivo, FOTOS.png.arquivo, FOTOS.pngRenomeado.arquivo]);
    await expect(page.getByText(/Enviada ·/)).toHaveCount(3);
    let pedidos = 0;
    page.on('request', (r) => {
      if (r.url().includes('/produtos/fotos/upload-url')) pedidos++;
    });
    await entrada(page).setInputFiles(FOTOS.jpeg.arquivo);
    await expect(page.getByText('Um produto aceita até 3 fotos.')).toBeVisible();
    expect(pedidos).toBe(0);
    await expect(page.locator('img[alt^="Prévia da foto"]')).toHaveCount(3);
  });

  test('arquivo > 5 MB é recusado no navegador, sem chamar a API nem o S3', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.grande');
    await entrarEEsperar(page, u.email);
    await abrirCadastro(page, unico('Grande'));
    const chamadas: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/upload-url') || r.url().includes('/s3/')) chamadas.push(r.url());
    });
    await entrada(page).setInputFiles(FOTOS.maiorQue5Mb.arquivo);
    await expect(page.getByText('Use imagem JPEG ou PNG de até 5 MB.')).toBeVisible();
    await expect(page.locator('img[alt^="Prévia da foto"]')).toHaveCount(0);
    expect(chamadas).toEqual([]);
    // sem foto aceita, o produto ainda pode ser salvo
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page).toHaveURL(/\/produtos\/\d+$/);
  });

  test('texto com extensão .jpg é recusado pelo tipo real (bytes), sem upload', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.texto');
    await entrarEEsperar(page, u.email);
    await abrirCadastro(page, unico('Texto'));
    const chamadas: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/upload-url') || r.url().includes('/s3/')) chamadas.push(r.url());
    });
    await entrada(page).setInputFiles(FOTOS.texto.arquivo);
    await expect(page.getByText('Use imagem JPEG ou PNG de até 5 MB.')).toBeVisible();
    await expect(page.locator('img[alt^="Prévia da foto"]')).toHaveCount(0);
    expect(chamadas).toEqual([]);
  });

  test('PNG renomeado .jpg é aceito e salvo como PNG', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.pngren');
    await entrarEEsperar(page, u.email);
    const nome = unico('PngRenomeado');
    await abrirCadastro(page, nome);
    await entrada(page).setInputFiles(FOTOS.pngRenomeado.arquivo);
    await expect(page.getByText(/Enviada ·/)).toBeVisible();
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page).toHaveURL(/\/produtos\/\d+$/);
    const det = await (await request.get(`${API_URL}/produtos/${page.url().split('/').pop()}`, { headers: bearer(u.token) })).json();
    expect(det.fotos[0].tipo).toBe('PNG');
  });

  test('remover foto antes de salvar descarta a prévia; "Tornar capa" reordena; o produto salva só as restantes', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.remover');
    await entrarEEsperar(page, u.email);
    await abrirCadastro(page, unico('Remover'));
    await entrada(page).setInputFiles([FOTOS.jpeg.arquivo, FOTOS.png.arquivo]);
    await expect(page.getByText(/Enviada ·/)).toHaveCount(2);
    await page.getByRole('button', { name: 'Tornar capa da foto 2' }).click();
    await page.getByRole('button', { name: 'Remover foto 2' }).click();
    await expect(page.locator('img[alt^="Prévia da foto"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Adicionar outra foto' })).toBeEnabled();
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page).toHaveURL(/\/produtos\/\d+$/);
    const det = await (await request.get(`${API_URL}/produtos/${page.url().split('/').pop()}`, { headers: bearer(u.token) })).json();
    expect(det.fotos).toHaveLength(1);
    expect(det.fotos[0].tipo).toBe('PNG'); // a PNG virou capa e a JPEG foi removida
  });

  test('o botão Salvar fica bloqueado enquanto a foto está sendo enviada', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.bloqueio');
    await entrarEEsperar(page, u.email);
    await abrirCadastro(page, unico('Bloqueio'));
    await page.route(/\/s3\//, async (rota) => {
      await new Promise((r) => setTimeout(r, 1500));
      await rota.continue();
    });
    await entrada(page).setInputFiles(FOTOS.png.arquivo);
    await expect(page.getByRole('button', { name: 'Salvar produto' })).toBeDisabled();
    await expect(page.getByRole('progressbar', { name: 'Enviando foto 1' })).toBeVisible();
    await expect(page.getByText(/Enviada ·/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Salvar produto' })).toBeEnabled();
  });

  test('falha no S3 mostra erro por foto com "Tentar de novo" e o envio funciona na segunda tentativa', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.falha');
    await entrarEEsperar(page, u.email);
    await abrirCadastro(page, unico('Falha'));
    let falhas = 0;
    await page.route(/\/s3\//, (rota) => {
      if (rota.request().method() === 'PUT' && falhas < 1) {
        falhas++;
        return rota.fulfill({ status: 500, body: 'erro' });
      }
      return rota.continue();
    });
    await entrada(page).setInputFiles(FOTOS.png.arquivo);
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Salvar produto' })).toBeEnabled();
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page.getByText('Reenvie ou remova as fotos que falharam antes de salvar.')).toBeVisible();
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByText(/Enviada ·/)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('cota de armazenamento (RF39)', () => {
  test('COTA_EXCEDIDA no upload mostra "Espaço do plano esgotado", o uso e o link Ver planos', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.cota'); // Individual: 1 GB
    const { produto } = await criarProduto(request, u, { nome: unico('Base') });
    await ocuparArmazenamento(produto.id, 1_073_741_824 - 10); // sobram 10 bytes
    await entrarEEsperar(page, u.email);
    await abrirCadastro(page, unico('Sem espaço'));
    await entrada(page).setInputFiles(FOTOS.jpeg.arquivo);
    const alerta = page.getByRole('alert').filter({ hasText: 'Espaço do plano esgotado.' });
    await expect(alerta).toBeVisible();
    await expect(alerta).toContainText(/Você usa 1(\.0)? GB de 1(\.0)? GB|Você usa/);
    await alerta.getByRole('link', { name: 'Ver planos' }).click();
    await expect(page).toHaveURL(/\/conta\/planos$/);
  });

  test('COTA_EXCEDIDA ao salvar (envio concorrente já estourou a cota) mostra o erro e não cria o produto', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.cota2');
    const { produto } = await criarProduto(request, u, { nome: unico('Base') });
    await entrarEEsperar(page, u.email);
    const nome = unico('Estoura ao salvar');
    await abrirCadastro(page, nome);
    await entrada(page).setInputFiles(FOTOS.jpeg.arquivo);
    await expect(page.getByText(/Enviada ·/)).toBeVisible();
    await ocuparArmazenamento(produto.id, 1_073_741_824 - 10); // outra pessoa encheu a cota nesse meio tempo
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Espaço do plano esgotado.' })).toBeVisible();
    await expect(page).toHaveURL(/\/produtos\/novo$/);
    const lista = await (await request.get(`${API_URL}/produtos?busca=${encodeURIComponent(nome)}`, { headers: bearer(u.token) })).json();
    expect(lista.total).toBe(0);
  });

  test('a tela 08 mostra o uso de armazenamento do plano (RF39): usado e limite', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.uso');
    await criarProduto(request, u, { fotos: [FOTOS.png] });
    await entrarEEsperar(page, u.email);
    await page.goto('/produtos/novo');
    await expect(page.getByRole('progressbar', { name: 'Armazenamento usado' }), 'a tela 08 não mostra o uso (só o limite do plano)').toBeVisible();
  });

  test('EDITOR vê o uso da Casa na tela 08 (RF39)', async ({ page, request }) => {
    const c = await montarCasa(request, { editores: 1, leitores: 0, prefixo: 'm3f.usoed' });
    await criarProduto(request, c.admin, { fotos: [FOTOS.png] });
    await entrarEEsperar(page, c.editor!.email);
    await page.goto('/produtos/novo');
    await expect(page.getByText(/Armazenamento/)).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Armazenamento usado' }), 'EDITOR só vê o limite, não o uso').toBeVisible();
  });
});

test.describe('edição de fotos e leitura por papel', () => {
  test('editar: adiciona uma foto, remove outra e a capa muda; o histórico conta as fotos', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.edit');
    const nome = unico('Editar fotos');
    const { produto } = await criarProduto(request, u, { nome, fotos: [FOTOS.png, FOTOS.jpeg] });
    await entrarEEsperar(page, u.email);
    await page.goto(`/produtos/${produto.id}/editar`);
    await expect(page.locator('fieldset img')).toHaveCount(2);
    await page.getByRole('button', { name: 'Remover foto 1' }).click();
    await entrada(page).setInputFiles(FOTOS.pngRenomeado.arquivo);
    await expect(page.getByText(/Enviada ·/)).toBeVisible();
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page).toHaveURL(new RegExp(`/produtos/${produto.id}$`));
    await imagensCarregadas(page, 'ul[aria-label="Fotos do produto"] img', 2);
    await expect(page.getByText('1 foto adicionada')).toBeVisible();
    await expect(page.getByText('1 foto removida')).toBeVisible();
    const det = await (await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(u.token) })).json();
    expect(det.fotos.map((f: any) => f.tipo)).toEqual(['JPEG', 'PNG']);
  });

  test('editar sem mexer nas fotos não envia `fotos` no PATCH (as fotos continuam)', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.semmexer');
    const { produto } = await criarProduto(request, u, { fotos: [FOTOS.png] });
    await entrarEEsperar(page, u.email);
    await page.goto(`/produtos/${produto.id}/editar`);
    let corpo: any = null;
    page.on('request', (r) => {
      if (r.method() === 'PATCH') corpo = r.postDataJSON();
    });
    await page.getByLabel('Quantidade').fill('9');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page).toHaveURL(new RegExp(`/produtos/${produto.id}$`));
    expect(corpo).not.toBeNull();
    expect(corpo).not.toHaveProperty('fotos');
    const det = await (await request.get(`${API_URL}/produtos/${produto.id}`, { headers: bearer(u.token) })).json();
    expect(det.fotos).toHaveLength(1);
  });

  test('LEITOR vê as fotos no detalhe e na lista (imagens carregam), sem ações de edição', async ({ page, request }) => {
    const c = await montarCasa(request, { editores: 0, leitores: 1, prefixo: 'm3f.leitor' });
    const { produto } = await criarProduto(request, c.admin, { fotos: [FOTOS.png, FOTOS.jpeg] });
    await entrarEEsperar(page, c.leitor!.email);
    await page.goto(`/produtos/${produto.id}`);
    await imagensCarregadas(page, 'ul[aria-label="Fotos do produto"] img', 2);
    await expect(page.getByRole('link', { name: 'Editar produto' })).toHaveCount(0);
    await page.goto('/produtos');
    await imagensCarregadas(page, 'main img', 1);
  });

  test('foto que não carrega (URL assinada vencida): o front refaz a consulta do produto', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.vencida');
    const { produto } = await criarProduto(request, u, { fotos: [FOTOS.png] });
    await entrarEEsperar(page, u.email);
    let bloqueou = 0;
    await page.route(/\/s3\//, (rota) => {
      if (bloqueou === 0) {
        bloqueou++;
        return rota.fulfill({ status: 403, body: 'Expired' });
      }
      return rota.continue();
    });
    let consultas = 0;
    page.on('request', (r) => {
      if (r.method() === 'GET' && new RegExp(`/api/produtos/${produto.id}$`).test(r.url())) consultas++;
    });
    await page.goto(`/produtos/${produto.id}`);
    await expect.poll(() => consultas, { timeout: 10_000, message: 'o front não refez a consulta do produto após a falha da imagem' }).toBeGreaterThanOrEqual(2);
  });

  test('excluir o produto apaga as fotos: a URL de leitura antiga deixa de responder', async ({ page, request }) => {
    const u = await criarUsuario(request, 'm3f.apagar');
    const { produto } = await criarProduto(request, u, { fotos: [FOTOS.png] });
    await entrarEEsperar(page, u.email);
    await page.goto(`/produtos/${produto.id}`);
    const src = (await page.locator('ul[aria-label="Fotos do produto"] img').first().getAttribute('src'))!;
    expect((await page.request.get(new URL(src, page.url()).toString())).status()).toBe(200);
    await page.getByRole('button', { name: 'Excluir produto' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Excluir produto' }).click();
    await expect(page).toHaveURL(/\/produtos$/);
    await expect.poll(async () => (await page.request.get(new URL(src, page.url()).toString())).status(), { timeout: 10_000 }).not.toBe(200);
  });
});
