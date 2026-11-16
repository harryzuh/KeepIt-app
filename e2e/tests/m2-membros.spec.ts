import { API_URL, criarUsuario, entrarEEsperar, expect, montarCasa, obterPerfil, test } from './helpers';

// M2 pela UI: telas 11, 12 e 22 (UC018, UC033 a UC037; RF25 a RF28, RNF12, RNF13).

test('tela 11: ADMIN vê membros, barra de uso, "(você)" e as ações de gestão', async ({ page, request }) => {
  const c = await montarCasa(request);
  await entrarEEsperar(page, c.admin.email);
  await page.goto('/familia');
  await expect(page.getByRole('heading', { name: 'Membros da Casa' })).toBeVisible();
  await expect(page.getByText('3 de 6 membros')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Uso do limite de membros' })).toHaveAttribute('aria-valuenow', '3');
  await expect(page.getByText('(você)')).toBeVisible();
  await expect(page.getByText(c.editor!.email)).toBeVisible();
  await expect(page.getByRole('link', { name: '+ Adicionar membro' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar nome da Casa' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Gerenciar/ })).toHaveCount(2);
});

test('EDITOR e LEITOR só visualizam: sem adicionar, gerenciar nem editar nome; tela 12 redireciona', async ({ page, request }) => {
  const c = await montarCasa(request);
  for (const u of [c.editor!, c.leitor!]) {
    await entrarEEsperar(page, u.email);
    await page.goto('/familia');
    await expect(page.getByText('3 de 6 membros')).toBeVisible();
    await expect(page.getByRole('link', { name: '+ Adicionar membro' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Gerenciar/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Editar nome da Casa' })).toHaveCount(0);
    await page.goto('/familia/adicionar');
    await expect(page).toHaveURL(/\/familia$/);
    await page.evaluate(() => localStorage.clear());
  }
});

test('adicionar membro pela tela 12 (UC033) e erros: sem conta, já na Casa', async ({ page, request }) => {
  const c = await montarCasa(request, { editores: 0, leitores: 0 });
  const novo = await criarUsuario(request, 'novo');
  await entrarEEsperar(page, c.admin.email);
  await page.goto('/familia/adicionar');
  await page.getByLabel('E-mail do membro').fill('ninguem.zzz@e2e.keepit.test');
  await page.getByRole('button', { name: 'Adicionar à Casa' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /conta KeepIT/i })).toBeVisible();
  await page.getByLabel('E-mail do membro').fill(novo.email);
  await page.getByLabel('Editor').check();
  await page.getByRole('button', { name: 'Adicionar à Casa' }).click();
  await expect(page).toHaveURL(/\/familia$/);
  await expect(page.getByText(/foi adicionado à Casa/)).toBeVisible();
  await expect(page.getByText('2 de 6 membros')).toBeVisible();
  const p = await obterPerfil(request, novo);
  expect(p.papel).toBe('EDITOR');
  expect(p.plano.nome).toBe('FAMILIA');
  await page.goto('/familia/adicionar');
  await page.getByLabel('E-mail do membro').fill(novo.email);
  await page.getByRole('button', { name: 'Adicionar à Casa' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /já faz parte/i })).toBeVisible();
});

test('limite do plano: Família no 6º membro troca o botão por aviso; API barra o 7º; Individual não comporta membro (RNF13)', async ({ page, request }) => {
  const c = await montarCasa(request, { editores: 2, leitores: 3 });
  await entrarEEsperar(page, c.admin.email);
  await page.goto('/familia');
  await expect(page.getByText('6 de 6 membros')).toBeVisible();
  await expect(page.getByRole('link', { name: '+ Adicionar membro' })).toHaveCount(0);
  await expect(page.getByText(/atingiu o limite de membros/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Trocar de plano' })).toBeVisible();
  // passar do limite pela tela 12 (URL direta)
  const extra = await criarUsuario(request, 'extra');
  await page.goto('/familia/adicionar');
  await page.getByLabel('E-mail do membro').fill(extra.email);
  await page.getByRole('button', { name: 'Adicionar à Casa' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /limite de membros/i })).toBeVisible();
  expect((await obterPerfil(request, extra)).casa.totalMembros).toBe(1);
});

test('tela 22: editar papel e remover com confirmação (UC035, UC036, RNF12)', async ({ page, request }) => {
  const c = await montarCasa(request, { editores: 0, leitores: 1 });
  await entrarEEsperar(page, c.admin.email);
  await page.goto('/familia');
  await page.getByRole('button', { name: new RegExp(`^Gerenciar ${c.leitor!.nome}`) }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('button', { name: 'Salvar papel' })).toBeDisabled();
  await modal.getByLabel('Editor').check();
  await modal.getByRole('button', { name: 'Salvar papel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await obterPerfil(request, c.leitor!)).papel).toBe('EDITOR');

  await page.getByRole('button', { name: new RegExp(`^Gerenciar ${c.leitor!.nome}`) }).click();
  await page.getByRole('button', { name: 'Remover da Casa' }).click();
  await expect(page.getByRole('dialog')).toContainText(`Remover ${c.leitor!.nome} da Casa?`);
  await page.getByRole('button', { name: 'Cancelar' }).click(); // volta sem remover
  await page.getByRole('button', { name: 'Remover da Casa' }).click();
  expect((await obterPerfil(request, c.leitor!)).casa.totalMembros).toBe(2); // nada removido ainda
  await page.getByRole('button', { name: 'Confirmar remoção' }).click();
  await expect(page.getByText('1 de 6 membros')).toBeVisible();
  const p = await obterPerfil(request, c.leitor!);
  expect(p).toMatchObject({ papel: 'ADMIN' });
  expect(p.plano.nome).toBe('INDIVIDUAL');
});

test('editar nome da Casa (RF32): validação no cliente e reflexo nos membros', async ({ page, request }) => {
  const c = await montarCasa(request, { editores: 0, leitores: 1 });
  await entrarEEsperar(page, c.admin.email);
  await page.goto('/familia');
  await page.getByRole('button', { name: 'Editar nome da Casa' }).click();
  const campo = page.getByRole('dialog').getByLabel('Nome');
  await campo.fill('');
  await page.getByRole('button', { name: 'Salvar nome' }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); // continua aberto com erro
  await campo.fill('<b>x</b>');
  await page.getByRole('button', { name: 'Salvar nome' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await campo.fill('Família Souza QA');
  await page.getByRole('button', { name: 'Salvar nome' }).click();
  await expect(page.getByRole('main').getByText('Família Souza QA')).toBeVisible();
  expect((await obterPerfil(request, c.leitor!)).casa.nome).toBe('Família Souza QA');
});

test('membro removido pelo ADMIN continua logado e passa a ver a Casa nova como ADMIN', async ({ page, request }) => {
  const c = await montarCasa(request, { editores: 1, leitores: 0 });
  await entrarEEsperar(page, c.editor!.email);
  await page.goto('/familia');
  await expect(page.getByText('2 de 6 membros')).toBeVisible();
  const r = await request.delete(`${API_URL}/casa/membros/${c.editor!.id}`, { headers: { Authorization: `Bearer ${c.admin.token}` } });
  expect(r.status()).toBe(204);
  await page.reload();
  await expect(page.getByText('1 de 1 membros')).toBeVisible();
});

test('tela 11: LEITOR sai da Casa pela UI (POST /casa/sair) e vira ADMIN de uma Casa Individual própria', async ({ page, request }) => {
  const casa = await montarCasa(request, { editores: 0, leitores: 1, prefixo: 'sair' });
  const antes = await obterPerfil(request, casa.admin);
  await entrarEEsperar(page, casa.leitor.email);
  await page.goto('/familia');
  // LEITOR não recebe e-mails dos outros membros nem vê ações de ADMIN
  await expect(page.getByText(casa.admin.email)).toHaveCount(0);
  await page.getByRole('button', { name: 'Sair da Casa' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Sair da Casa?' });
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole('button', { name: 'Sair da Casa' }).click();
  await expect(page.getByText(/Você saiu da Casa/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sair da Casa' })).toHaveCount(0); // agora é ADMIN

  const depois = await obterPerfil(request, casa.leitor);
  expect(depois.papel).toBe('ADMIN');
  expect(depois.plano.nome).toBe('INDIVIDUAL');
  expect(depois.casa.id).not.toBe(antes.casa.id);
  expect((await obterPerfil(request, casa.admin)).casa.totalMembros).toBe(antes.casa.totalMembros - 1);
});
