import type { Page } from '@playwright/test';
import { CARTAO, contratarPlano, criarUsuario, entrarEEsperar, expect, montarCasa, obterPerfil, salvarMetodoPagamento, test, type UsuarioE2E } from './helpers';

// M5 pela UI: telas 13, 14, 15 e 24 (UC019, UC028 a UC032; RF12 a RF16, RF38).

async function cadastrarCartaoNaTela(page: Page, cartao = CARTAO.aprovado) {
  await page.getByLabel('Número do cartão').fill(cartao.numero);
  await page.getByLabel('Validade').fill(cartao.validade);
  await page.getByRole('button', { name: 'Salvar cartão' }).click();
}

test('tela 13: três planos, Individual sem botão Assinar e selo de plano atual', async ({ page, request }) => {
  const u = await criarUsuario(request, 'planos');
  await entrarEEsperar(page, u.email);
  await page.goto('/conta/planos');
  await expect(page.getByText('Planos', { exact: true }).first()).toBeVisible();
  for (const nome of ['Individual', 'Família', 'Business']) await expect(page.getByLabel(`Plano ${nome}`)).toBeVisible();
  await expect(page.getByLabel('Plano Individual').locator('span', { hasText: 'Plano atual' })).toBeVisible();
  await expect(page.getByLabel('Plano Individual').getByRole('button', { name: /^Assinar/ })).toHaveCount(0);
  await expect(page.getByLabel('Plano Família').getByText('Mais escolhido')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Assinar/ })).toHaveCount(2);
});

test('contratar Família como ADMIN: cartão novo, pagamento simulado, tela 15 ATIVA e perfil atualizado (UC028)', async ({ page, request }) => {
  const u = await criarUsuario(request, 'assina');
  await entrarEEsperar(page, u.email);
  await page.goto('/conta/planos');
  await page.getByRole('button', { name: 'Assinar Família' }).click();
  await expect(page).toHaveURL(/\/conta\/planos\/familia\/pagamento$/);
  await expect(page.getByRole('button', { name: /Confirmar e pagar/ })).toBeDisabled(); // sem cartão
  await cadastrarCartaoNaTela(page);
  await expect(page.getByText('final 4242')).toBeVisible();
  await page.getByRole('button', { name: /Confirmar e pagar/ }).click();
  await expect(page).toHaveURL(/\/conta\/assinatura$/);
  await expect(page.getByText('Assinatura do plano Família ativada.')).toBeVisible();
  await expect(page.getByText('ATIVA', { exact: true })).toBeVisible();
  await expect(page.getByText('1 de 6')).toBeVisible();
  const p = await obterPerfil(request, u);
  expect(p.plano.nome).toBe('FAMILIA');
});

test('pagamento recusado (cartão final 0000): erro na tela e plano continua Individual', async ({ page, request }) => {
  const u = await criarUsuario(request, 'recusa');
  await salvarMetodoPagamento(request, u, CARTAO.recusado);
  await entrarEEsperar(page, u.email);
  await page.goto('/conta/planos/familia/pagamento');
  await page.getByRole('button', { name: /Confirmar e pagar/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: /recusado/i })).toBeVisible();
  await expect(page).toHaveURL(/\/pagamento$/);
  expect((await obterPerfil(request, u)).plano.nome).toBe('INDIVIDUAL');
});

test('cartão inválido é barrado no formulário (Luhn e validade)', async ({ page, request }) => {
  const u = await criarUsuario(request, 'luhn');
  await entrarEEsperar(page, u.email);
  await page.goto('/conta/planos/business/pagamento');
  await cadastrarCartaoNaTela(page, { ...CARTAO.aprovado, numero: '4242 4242 4242 4241' });
  await expect(page.getByRole('button', { name: 'Salvar cartão' })).toBeVisible(); // continua no formulário
  await expect(page.getByRole('button', { name: /Confirmar e pagar/ })).toBeDisabled();
});

test('cancelar exige confirmação, mantém benefícios até a renovação e permite reativar (UC031, RF16)', async ({ page, request }) => {
  const c = await montarCasa(request, { editores: 1, leitores: 0 });
  await entrarEEsperar(page, c.admin.email);
  await page.goto('/conta/assinatura');
  await page.getByRole('button', { name: 'Cancelar assinatura' }).click();
  const modal = page.getByRole('dialog');
  await expect(modal).toContainText('Você continua com os benefícios');
  await modal.getByRole('button', { name: 'Manter assinatura' }).click();
  expect((await obterPerfil(request, c.admin)).assinatura.status).toBe('ATIVA'); // fechar não cancela

  await page.getByRole('button', { name: 'Cancelar assinatura' }).click();
  await page.getByRole('dialog').getByLabel('Motivo (opcional)').fill('Está caro');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(page.getByText('CANCELADA', { exact: true })).toBeVisible();
  await expect(page.getByText(/Você mantém os benefícios até/)).toBeVisible();
  const p = await obterPerfil(request, c.admin);
  expect(p.plano.nome).toBe('FAMILIA');
  expect(p.casa.totalMembros).toBe(2); // membro extra continua até a renovação

  await page.goto('/conta/planos');
  await expect(page.getByText(/Assinatura cancelada: benefícios até/)).toBeVisible();
  await page.goto('/conta/assinatura');
  await page.getByRole('button', { name: 'Reativar assinatura' }).click();
  await expect(page.getByText('ATIVA', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar assinatura' })).toBeVisible();
});

test('trocar de plano: Família para Business cria assinatura nova na hora', async ({ page, request }) => {
  const c = await montarCasa(request, { editores: 0, leitores: 0 });
  await entrarEEsperar(page, c.admin.email);
  await page.goto('/conta/planos');
  await expect(page.getByLabel('Plano Família').locator('span', { hasText: 'Plano atual' })).toBeVisible();
  await page.getByRole('button', { name: 'Assinar Business' }).click();
  await expect(page.getByText(/cabem no plano/)).toBeVisible();
  await page.getByRole('button', { name: /Confirmar e pagar/ }).click();
  await expect(page).toHaveURL(/\/conta\/assinatura$/);
  expect((await obterPerfil(request, c.admin)).plano.nome).toBe('BUSINESS');
});

test('EDITOR e LEITOR: veem planos, mas tela 15 é só do ADMIN (redireciona)', async ({ page, request }) => {
  const c = await montarCasa(request);
  for (const u of [c.editor!, c.leitor!]) {
    await entrarEEsperar(page, u.email);
    await page.goto('/conta/assinatura');
    await expect(page).toHaveURL(/\/conta\/planos$/);
    await expect(page.getByText('Planos', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancelar assinatura' })).toHaveCount(0);
    await page.evaluate(() => localStorage.clear());
  }
});

test('RF38 / tela 24: LEITOR que assina avisa a saída, sai da Casa e vira ADMIN de uma Casa nova', async ({ page, request }) => {
  const c = await montarCasa(request, { editores: 0, leitores: 1 });
  const antes = await obterPerfil(request, c.leitor!);
  await salvarMetodoPagamento(request, c.leitor!);
  await entrarEEsperar(page, c.leitor!.email);
  await page.goto('/conta/planos');
  await page.getByRole('button', { name: 'Assinar Família' }).click();
  const modal = page.getByRole('dialog');
  await expect(modal).toContainText('Você vai criar uma nova Casa');
  await modal.getByRole('button', { name: 'Ficar na Casa atual' }).click();
  expect((await obterPerfil(request, c.leitor!)).casa.id).toBe(antes.casa.id); // nada mudou

  await page.getByRole('button', { name: 'Assinar Família' }).click();
  await page.getByRole('button', { name: 'Continuar para o pagamento' }).click();
  await expect(page).toHaveURL(/\/pagamento$/);
  await page.getByRole('button', { name: /Confirmar e pagar/ }).click();
  await expect(page).toHaveURL(/\/conta\/assinatura$/);
  const p = await obterPerfil(request, c.leitor!);
  expect(p.papel).toBe('ADMIN');
  expect(p.plano.nome).toBe('FAMILIA');
  expect(p.casa.id).not.toBe(antes.casa.id);
  expect(p.casa.totalMembros).toBe(1);
  const adm = await obterPerfil(request, c.admin);
  expect(adm.casa.totalMembros).toBe(1); // o LEITOR saiu da Casa do ADMIN
});

test('membro sem passar pelo aviso é devolvido à tela 13 ao abrir o pagamento direto', async ({ page, request }) => {
  const c = await montarCasa(request, { editores: 0, leitores: 1 });
  await entrarEEsperar(page, c.leitor!.email);
  await page.goto('/conta/planos/familia/pagamento');
  await expect(page).toHaveURL(/\/conta\/planos$/);
});

test('tela 21: exclusão de conta do titular, aviso do ADMIN e efeitos (UC013)', async ({ page, request }) => {
  const c = await montarCasa(request, { editores: 1, leitores: 0 });
  await entrarEEsperar(page, c.admin.email);
  await page.goto('/conta');
  await page.getByRole('button', { name: /Excluir/ }).first().click();
  const modal = page.getByRole('dialog');
  await expect(modal).toContainText('ADMIN');
  // Contrato m2-casa.md seção 7: o aviso deve citar o plano e que o membro mais antigo assume a Casa.
  await expect(modal, 'aviso deve mencionar que o membro mais antigo assume a Casa').toContainText(/mais antigo/i);
  await modal.getByLabel('Digite sua senha para confirmar').fill(c.admin.senha);
  await modal.getByRole('button', { name: 'Excluir minha conta' }).click();
  await expect(page).toHaveURL(/\/(entrar|$)/);
  const herdeiro = await obterPerfil(request, c.editor!);
  expect(herdeiro.papel).toBe('ADMIN');
  expect(herdeiro.plano.nome).toBe('INDIVIDUAL');
});
