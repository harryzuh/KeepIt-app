import { expect, test, API_URL, SENHA, cadastrarPelaApi, digitarCodigo, emailUnico, entrar, lerCodigoNoMailpit } from './helpers';

// Histórias 1.3 (UC006/007/009, telas 04 e 18). Código lido no Mailpit.
test.describe.configure({ mode: 'serial' });

const email = emailUnico('recuperar');
const novaSenha = 'novasenha99';
let tokenAntigo = '';

test.beforeAll(async ({ request }) => {
  tokenAntigo = (await cadastrarPelaApi(request, 'Rita Recupera', email)).token;
});

test('e-mail sem conta mostra erro (UC006)', async ({ page }) => {
  await page.goto('/recuperar-senha');
  await page.getByLabel('E-mail').fill(emailUnico('semconta'));
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.getByText(/Não encontramos uma conta/)).toBeVisible();
});

test('código errado volta à etapa do código; código certo troca a senha sem login automático', async ({ page, request }) => {
  await page.goto('/recuperar-senha');
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.getByRole('heading', { name: 'Digite o código' })).toBeVisible();
  const codigo = await lerCodigoNoMailpit(request, email, 'redefinir');

  // 1) código errado: a API só confere na etapa 3 (ADR A4)
  const errado = codigo === '000000' ? '111111' : '000000';
  await digitarCodigo(page, errado);
  await page.getByRole('button', { name: 'Confirmar código' }).click();
  await page.getByLabel('Nova senha', { exact: true }).fill(novaSenha);
  await page.getByLabel('Confirmar nova senha', { exact: true }).fill(novaSenha);
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.getByRole('heading', { name: 'Digite o código' })).toBeVisible();
  await expect(page.getByText(/Código inválido ou expirado/).first()).toBeVisible();

  // 2) código certo
  await digitarCodigo(page, codigo);
  await page.getByRole('button', { name: 'Confirmar código' }).click();
  await page.getByLabel('Nova senha', { exact: true }).fill(novaSenha);
  await page.getByLabel('Confirmar nova senha', { exact: true }).fill(novaSenha);
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(page.getByText('Senha alterada. Entre com a nova senha.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('keepit.token'))).toBeNull();

  // sessões antigas encerradas e código de uso único
  const r = await request.get(`${API_URL}/me`, { headers: { Authorization: `Bearer ${tokenAntigo}` } });
  expect(r.status()).toBe(401);
  const reuso = await request.post(`${API_URL}/auth/redefinir-senha`, {
    data: { email, codigo, novaSenha: 'outrasenha11', confirmarSenha: 'outrasenha11' },
  });
  expect(reuso.status()).toBe(400);
  expect((await reuso.json()).error).toBe('CODIGO_INVALIDO');
});

test('senha antiga deixa de valer e a nova entra', async ({ page }) => {
  await entrar(page, email, SENHA);
  await expect(page.getByText('E-mail ou senha inválidos')).toBeVisible();
  await page.getByLabel('Senha', { exact: true }).fill(novaSenha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/inicio$/);
});

// Código expirado (15 min) não tem teste E2E: exige adiantar o relógio ou editar o banco. Coberto no curl (docs/qa/sprint-1-m1.md, caso A-27).
