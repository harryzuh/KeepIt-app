import { API_URL, bearer, criarUsuario, dispararJobs, expect, montarCasa, obterPerfil, test } from './helpers';

// Reteste 1 (Sprint 2): verificações das correções do back-end contra a API real.

test.describe('Reteste 1: API', () => {
  test('POST /casa/sair: matriz de papéis, EDITOR vira ADMIN de Casa Individual própria', async ({ request }) => {
    const c = await montarCasa(request, { editores: 1, leitores: 1 });
    expect((await request.post(`${API_URL}/casa/sair`)).status()).toBe(401);
    expect((await request.post(`${API_URL}/casa/sair`, { headers: bearer(c.admin.token) })).status()).toBe(403);
    const r = await request.post(`${API_URL}/casa/sair`, { headers: bearer(c.editor!.token) });
    expect(r.status(), await r.text()).toBe(200);
    const corpo = await r.json();
    expect(corpo.perfil.papel).toBe('ADMIN');
    expect(corpo.perfil.casa.totalMembros).toBe(1);
    const adm = await obterPerfil(request, c.admin);
    expect(adm.casa.totalMembros).toBe(2);
    expect((await request.post(`${API_URL}/casa/sair`, { headers: bearer(c.leitor!.token) })).status()).toBe(200);
    // quem já saiu é ADMIN solo: 403
    expect((await request.post(`${API_URL}/casa/sair`, { headers: bearer(c.editor!.token) })).status()).toBe(403);
  });

  test('GET /casa/membros: e-mail só para o ADMIN', async ({ request }) => {
    const c = await montarCasa(request, { editores: 1, leitores: 1 });
    const adm = await (await request.get(`${API_URL}/casa/membros`, { headers: bearer(c.admin.token) })).json();
    const lei = await request.get(`${API_URL}/casa/membros`, { headers: bearer(c.leitor!.token) });
    const texto = await lei.text();
    expect(JSON.stringify(adm)).toContain(c.editor!.email);
    expect(texto).not.toContain(c.editor!.email);
    expect(texto).not.toContain(c.admin.email);
  });

  test('ids fora do int4 em /casa/membros/:usuarioId dão 422, não 500', async ({ request }) => {
    const c = await montarCasa(request, { editores: 0, leitores: 0 });
    const h = { headers: bearer(c.admin.token) };
    expect((await request.delete(`${API_URL}/casa/membros/99999999999`, h)).status()).toBe(422);
    expect((await request.patch(`${API_URL}/casa/membros/99999999999`, { ...h, data: { papel: 'LEITOR' } })).status()).toBe(422);
    expect((await request.delete(`${API_URL}/casa/membros/2147483647`, h)).status()).toBe(404);
  });

  test('POST /casa/membros: ADMIN de Casa cheia sempre recebe LIMITE_MEMBROS, sem oráculo de e-mail', async ({ request }) => {
    const admin = await criarUsuario(request, 'oraculo'); // Individual: limite 1
    const alvo = await criarUsuario(request, 'alvo');
    const existente = await request.post(`${API_URL}/casa/membros`, { headers: bearer(admin.token), data: { email: alvo.email } });
    const inexistente = await request.post(`${API_URL}/casa/membros`, { headers: bearer(admin.token), data: { email: `nao.existe.${Date.now()}@keepit.local` } });
    expect(existente.status()).toBe(409);
    expect(inexistente.status()).toBe(409);
    expect((await existente.json()).error).toBe('LIMITE_MEMBROS');
    expect((await inexistente.json()).error).toBe('LIMITE_MEMBROS');
  });

  test('PUT /pagamento/metodo aceita apenas os cartões de teste', async ({ request }) => {
    const u = await criarUsuario(request, 'pan');
    const real = await request.put(`${API_URL}/pagamento/metodo`, { headers: bearer(u.token), data: { numero: '4532 0151 1283 0366', validade: '12/39' } });
    expect(real.status()).toBe(422);
  });

  test('POST /internal/jobs devolve falhas = 0 numa execução limpa', async ({ request }) => {
    const r = await dispararJobs(request);
    expect(r.falhas).toBe(0);
  });
});

test('Reteste 1: LEITOR vê a tela 11 sem e-mails e sem erro de renderização', async ({ page, request }) => {
  const { entrarEEsperar } = await import('./helpers');
  const c = await montarCasa(request, { editores: 1, leitores: 1 });
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await entrarEEsperar(page, c.leitor!.email, c.leitor!.senha);
  await page.goto('/familia');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(c.editor!.nome)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('undefined');
  await expect(page.locator('body')).not.toContainText(c.editor!.email);
  expect(erros).toEqual([]);
});
