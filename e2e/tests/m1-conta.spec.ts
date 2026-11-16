import { expect, test, API_URL, SENHA, cadastrarPelaApi, digitarCodigo, emailUnico, entrar, entrarEEsperar, lerCodigoNoMailpit, tokenGuardado } from './helpers';

// Histórias 8.1 (dados), 1.5 (alterar senha), 8.2 (alterar e-mail), 8.3 (excluir conta), telas 16, 19, 20, 21.
test.describe.configure({ mode: 'serial' });

const email = emailUnico('conta');
const emailNovo = emailUnico('contanovo');
const senhaNova = 'trocada12345';

test.beforeAll(async ({ request }) => {
  await cadastrarPelaApi(request, 'Carla Conta', email);
});

test('tela 16 mostra nome, e-mail MASCARADO (RNF25) e papel', async ({ page }) => {
  await entrarEEsperar(page, email);
  await page.goto('/conta');
  await expect(page.getByRole('heading', { name: 'Minha conta' })).toBeVisible();
  await expect(page.getByText('Carla Conta').first()).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
  await expect(page.getByText(/\*+/).first()).toBeVisible();
  await expect(page.getByRole('main').getByText('ADMIN')).toBeVisible();
});

test('tela 20 edita o nome (UC015)', async ({ page }) => {
  await entrarEEsperar(page, email);
  await page.goto('/conta/dados');
  await page.getByLabel('Nome').fill('Carla Editada');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Dados atualizados.')).toBeVisible();
  await page.goto('/inicio');
  await expect(page.getByRole('heading', { name: 'Olá, Carla' })).toBeVisible();
});

test('tela 19: senha atual errada, nova igual à atual e sucesso com troca de token', async ({ page }) => {
  await entrarEEsperar(page, email);
  await page.goto('/conta/senha');
  const campos = async (atual: string, nova: string) => {
    await page.getByLabel('Senha atual', { exact: true }).fill(atual);
    await page.getByLabel('Nova senha', { exact: true }).fill(nova);
    await page.getByLabel('Confirmar nova senha', { exact: true }).fill(nova);
  };
  await campos('errada12345', senhaNova);
  await page.getByRole('button', { name: 'Alterar senha' }).click();
  await expect(page.getByText('Senha atual incorreta')).toBeVisible();
  expect(await tokenGuardado(page)).toBeTruthy(); // SENHA_INCORRETA não encerra a sessão
  await expect(page).toHaveURL(/\/conta\/senha$/);

  await campos(SENHA, SENHA);
  // a validação do front já impede enviar nova == atual (a API também rejeita: SENHA_IGUAL_ATUAL, coberto no curl)
  await expect(page.getByText('A nova senha deve ser diferente da atual')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Alterar senha' })).toBeDisabled();

  const antes = await tokenGuardado(page);
  await campos(SENHA, senhaNova);
  await page.getByRole('button', { name: 'Alterar senha' }).click();
  await expect(page).toHaveURL(/\/conta$/);
  await expect(page.getByText('Senha alterada com sucesso.')).toBeVisible();
  expect(await tokenGuardado(page)).not.toBe(antes);
  // sessão atual segue válida
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Minha conta' })).toBeVisible();
});

test('tela 20: troca de e-mail por código enviado ao NOVO endereço (RF19)', async ({ page, request }) => {
  await entrarEEsperar(page, email, senhaNova);
  await page.goto('/conta/dados');
  await page.getByLabel('E-mail').fill(emailNovo);
  // senha errada: fica no formulário com erro no campo (reautenticação — ACH-01)
  await page.getByLabel('Senha atual').fill('senhaerrada1');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Senha atual incorreta')).toBeVisible();
  await page.getByLabel('Senha atual').fill(senhaNova);
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('heading', { name: 'Confirme o novo e-mail' })).toBeVisible();

  const codigo = await lerCodigoNoMailpit(request, emailNovo, 'e-mail');
  const errado = codigo === '000000' ? '111111' : '000000';
  await digitarCodigo(page, errado);
  await page.getByRole('button', { name: 'Confirmar e-mail' }).click();
  await expect(page.getByText(/Código inválido ou expirado/)).toBeVisible();

  await digitarCodigo(page, codigo);
  await page.getByRole('button', { name: 'Confirmar e-mail' }).click();
  await expect(page.getByText(/E-mail alterado/)).toBeVisible();
  // a API devolve token novo na confirmação: a sessão segue válida após recarregar
  await page.reload();
  await expect(page.getByLabel('E-mail')).toHaveValue(emailNovo);

  // próximo login exige o novo e-mail
  const antigo = await request.post(`${API_URL}/auth/login`, { data: { email, senha: senhaNova } });
  expect(antigo.status()).toBe(401);
  const novo = await request.post(`${API_URL}/auth/login`, { data: { email: emailNovo, senha: senhaNova } });
  expect(novo.status()).toBe(200);
});

test('tela 20: e-mail já em uso mostra erro no campo', async ({ page }) => {
  await entrarEEsperar(page, emailNovo, senhaNova);
  await page.goto('/conta/dados');
  await page.getByLabel('E-mail').fill('demo@keepit.local');
  await page.getByLabel('Senha atual').fill(senhaNova);
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText(/já está cadastrado/i)).toBeVisible();
});

test('tela 21: exclusão exige senha; senha errada mantém a conta; senha certa bloqueia o acesso (UC013/014)', async ({ page, request }) => {
  await entrarEEsperar(page, emailNovo, senhaNova);
  await page.goto('/conta');
  await page.getByRole('button', { name: /Excluir conta/ }).click();
  const dialogo = page.getByRole('dialog', { name: 'Excluir sua conta?' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole('button', { name: 'Excluir minha conta' })).toBeDisabled();

  await dialogo.getByLabel('Digite sua senha para confirmar', { exact: true }).fill('senhaerrada1');
  await dialogo.getByRole('button', { name: 'Excluir minha conta' }).click();
  await expect(dialogo.getByText(/incorreta/i)).toBeVisible();
  expect(await tokenGuardado(page)).toBeTruthy();

  // Escape fecha sem excluir
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  const ainda = await request.post(`${API_URL}/auth/login`, { data: { email: emailNovo, senha: senhaNova } });
  expect(ainda.status()).toBe(200);

  await page.getByRole('button', { name: /Excluir conta/ }).click();
  await page.getByLabel('Digite sua senha para confirmar', { exact: true }).fill(senhaNova);
  await page.getByRole('button', { name: 'Excluir minha conta' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/24 h/)).toBeVisible();
  expect(await tokenGuardado(page)).toBeNull();

  // bloqueio imediato: login com a mesma resposta genérica; e-mail segue reservado
  const login = await request.post(`${API_URL}/auth/login`, { data: { email: emailNovo, senha: senhaNova } });
  expect(login.status()).toBe(401);
  expect((await login.json()).error).toBe('CREDENCIAIS_INVALIDAS');
  const recad = await request.post(`${API_URL}/auth/cadastro`, {
    data: { nome: 'X', email: emailNovo, senha: SENHA, confirmarSenha: SENHA },
  });
  expect(recad.status()).toBe(409);
});
