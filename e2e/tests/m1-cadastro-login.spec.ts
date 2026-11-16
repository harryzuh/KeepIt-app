import { expect, test, SENHA, API_URL, emailUnico, entrar, tokenGuardado } from './helpers';

// Histórias 1.2 (cadastro + Casa automática), 1.1 (login), 1.4 (logout), 1.0 (guardas) e 1.0.1 (boas-vindas).
// Usa 1 conta criada pela UI; fluxo em série porque cada passo depende do anterior.
test.describe.configure({ mode: 'serial' });

const email = emailUnico('cadlogin');

test('tela 01 leva a Entrar, Criar conta e Termos', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Criar conta' })).toBeVisible();
  await page.getByRole('link', { name: /Termos de uso/ }).click();
  await expect(page).toHaveURL(/\/termos$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('rotas protegidas sem sessão redirecionam para a tela 02', async ({ page }) => {
  for (const rota of ['/inicio', '/conta', '/conta/dados', '/conta/senha']) {
    await page.goto(rota);
    await expect(page).toHaveURL(/\/entrar$/);
  }
});

test('cadastro: validação em tempo real (senha < 8, senhas diferentes) mantém o botão desabilitado', async ({ page }) => {
  await page.goto('/criar-conta');
  const botao = page.getByRole('button', { name: 'Cadastrar' });
  await page.getByLabel('Nome').fill('Ana Teste');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('abc123');
  await page.getByLabel('Confirmar senha', { exact: true }).fill('abc123');
  await expect(botao).toBeDisabled();
  await page.getByLabel('Senha', { exact: true }).fill(SENHA);
  await page.getByLabel('Confirmar senha', { exact: true }).fill('outra12345');
  await expect(botao).toBeDisabled();
  await expect(page.getByText('As senhas não conferem')).toBeVisible();
});

test('cadastro cria a conta, a Casa Individual e entra como ADMIN (RF32)', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome').fill('Ana Teste');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(SENHA);
  await page.getByLabel('Confirmar senha', { exact: true }).fill(SENHA);
  await page.getByRole('button', { name: 'Cadastrar' }).click();

  await expect(page).toHaveURL(/\/inicio$/);
  await expect(page.getByRole('heading', { name: 'Olá, Ana' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Casa de Ana')).toBeVisible();
  await expect(page.getByRole('main').getByText('ADMIN')).toBeVisible();
  // Sprint 4: o Início passou a repetir o plano na linha do resumo (M4), por isso .first().
  await expect(page.getByText('Plano Individual').first()).toBeVisible();
  await expect(page.getByText('1 membro')).toBeVisible();
  expect(await tokenGuardado(page)).toBeTruthy();

  // Sessão sobrevive ao recarregar (critério da história 1.1).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Olá, Ana' })).toBeVisible();
  // Usuário logado não vê as telas públicas.
  await page.goto('/entrar');
  await expect(page).toHaveURL(/\/inicio$/);
});

test('cadastro com e-mail já usado mostra erro junto ao campo (também em maiúsculas)', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Nome').fill('Outra Pessoa');
  await page.getByLabel('E-mail').fill(email.toUpperCase());
  await page.getByLabel('Senha', { exact: true }).fill(SENHA);
  await page.getByLabel('Confirmar senha', { exact: true }).fill(SENHA);
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByText(/já está cadastrado/i)).toBeVisible();
  await expect(page).toHaveURL(/\/criar-conta$/);
});

test('logout encerra a sessão, apaga o token e bloqueia /conta (UC012)', async ({ page }) => {
  await entrar(page, email);
  await expect(page).toHaveURL(/\/inicio$/);
  const tokenAntigo = await tokenGuardado(page);
  await page.getByRole('link', { name: 'Ir para Minha conta' }).click();
  await page.getByRole('button', { name: 'Encerrar sessão' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await tokenGuardado(page)).toBeNull();
  await page.goto('/conta');
  await expect(page).toHaveURL(/\/entrar$/);

  // O token antigo deixa de valer no servidor (A1).
  const r = await page.request.get(`${API_URL}/me`, { headers: { Authorization: `Bearer ${tokenAntigo}` } });
  expect(r.status()).toBe(401);
});

test('login inválido mostra mensagem genérica e não derruba nada; e-mail inexistente igual', async ({ page }) => {
  await entrar(page, email, 'senhaerrada1');
  await expect(page.getByText('E-mail ou senha inválidos')).toBeVisible();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.getByLabel('E-mail').fill(emailUnico('inexistente'));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('E-mail ou senha inválidos')).toBeVisible();
});

test('login válido leva à tela 05 e mantém sessão após reload', async ({ page }) => {
  await entrar(page, email);
  await expect(page).toHaveURL(/\/inicio$/);
  await expect(page.getByRole('main').getByText('Casa de Ana')).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/inicio$/);
});

test('login com campos vazios mantém o botão desabilitado', async ({ page }) => {
  await page.goto('/entrar');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeDisabled();
});
