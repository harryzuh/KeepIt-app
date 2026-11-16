import { API_URL, entrar, expect, test } from './helpers';

// QA Sprint 4 (M4), RNF06: carregamento < 2 s com 10.000 produtos e 200 tags. Requer `make seed-volume` (Casa carga@keepit.local).
// Sem o volume o teste é pulado (o CI não roda o volume, ADR 0004, Q10).
const EMAIL = 'carga@keepit.local';
const SENHA = 'keepit-carga-123';

test('Início (desktop) e rotas da API com 10.000 produtos carregam em menos de 2 s', async ({ page, request }) => {
  const login = await request.post(`${API_URL}/auth/login`, { data: { email: EMAIL, senha: SENHA } });
  test.skip(login.status() !== 200, 'Casa de carga ausente: rode make seed-volume');
  const { token } = await login.json();
  const h = { Authorization: `Bearer ${token}` };
  const perfilProdutos = await (await request.get(`${API_URL}/estatisticas/resumo`, { headers: h })).json();
  test.skip(perfilProdutos.produtos < 10_000, 'Volume menor que 10.000 produtos: rode make seed-volume');

  for (const rota of ['/estatisticas/resumo', '/estatisticas']) {
    const tempos: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      const r = await request.get(`${API_URL}${rota}`, { headers: h });
      expect(r.status()).toBe(200);
      await r.body();
      tempos.push(Date.now() - t0);
    }
    tempos.sort((a, b) => a - b);
    console.log(`API ${rota}: mediana ${tempos[5]} ms, máx ${tempos[9]} ms`);
    expect(tempos[9], `${rota} máx`).toBeLessThan(500);
  }

  await entrar(page, EMAIL, SENHA);
  await expect(page).toHaveURL(/\/inicio$/);
  await page.evaluate(() => performance.clearMarks());
  const t0 = Date.now();
  await page.goto('/inicio');
  await expect(page.getByRole('group', { name: /^Valor total:/ })).toContainText(/R\$\s*[\d.]+,\d{2}/);
  await expect(page.getByRole('group', { name: /^Valor médio:/ })).not.toContainText('—');
  const inicio = Date.now() - t0;
  const t1 = Date.now();
  await page.goto('/estatisticas');
  await expect(page.getByRole('img', { name: /do valor total/ }).first()).toBeVisible();
  const completa = Date.now() - t1;
  console.log(`Início (desktop, indicadores visíveis): ${inicio} ms; Estatísticas: ${completa} ms`);
  expect(inicio).toBeLessThan(2000);
  expect(completa).toBeLessThan(2000);
});
