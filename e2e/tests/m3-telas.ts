import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import {
  botoesComNome, camposComRotulo, focoVisivel, nomeArquivo, semRolagemHorizontal, temH1,
} from './sprint2-telas';
import { criarProduto, criarTag, entrarEEsperar, expect, FOTOS, montarCasa, type CasaE2E } from './helpers';

export { entrarEEsperar };

export interface CenarioTelas {
  casa: CasaE2E;
  produtoId: number;
  produtoNome: string;
}

/** Casa com ADMIN/EDITOR/LEITOR, uma tag e um produto com 2 fotos (para detalhe, edição e lista). */
export async function prepararCenarioM3(request: Parameters<typeof montarCasa>[0]): Promise<CenarioTelas> {
  const casa = await montarCasa(request, { editores: 1, leitores: 1, prefixo: 'm3tela' });
  const tag = await criarTag(request, casa.admin, 'Cozinha');
  const { produto } = await criarProduto(request, casa.admin, {
    nome: 'Cafeteira Elétrica com nome bem comprido para testar quebra de linha em 360px',
    descricao: 'Preta, 15 xícaras. Descrição longa o bastante para ocupar mais de uma linha no detalhe do produto.',
    preco: '1234.50', quantidade: 2, tagIds: [tag.id], fotos: [FOTOS.png, FOTOS.jpeg],
  });
  await request.patch(`${process.env.E2E_API_URL ?? 'http://localhost:3333'}/produtos/${produto.id}`, {
    headers: { Authorization: `Bearer ${casa.editor!.token}` }, data: { quantidade: 5 },
  });
  return { casa, produtoId: produto.id, produtoNome: produto.nome };
}

export async function capturar(page: Page, info: TestInfo, nome: string) {
  await page.screenshot({ path: `test-results/sprint3-telas/${info.project.name}-${nome}.png`, fullPage: true });
}

/** Espera as imagens da página terminarem (carregadas ou falhas) para a captura sair estável. */
export async function esperarImagens(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
}

export async function auditarTela(page: Page, info: TestInfo, rota: string, opcoes: { alvos: boolean; nome?: string }) {
  await page.goto(rota);
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await esperarImagens(page);
  await capturar(page, info, opcoes.nome ?? nomeArquivo(rota));
  await semRolagemHorizontal(page, rota);
  await camposComRotulo(page, rota);
  await botoesComNome(page, rota);
  await temH1(page, rota);
  await focoVisivel(page, rota);
  if (opcoes.alvos) await alvosDeToqueM3(page, rota);
  await imagensComAlt(page, rota);
}

export async function imagensComAlt(page: Page, rota: string) {
  const semAlt = await page.evaluate(() => [...document.images].filter((i) => !i.hasAttribute('alt')).map((i) => i.outerHTML.slice(0, 100)));
  expect(semAlt, `imagens sem atributo alt em ${rota}`).toEqual([]);
}

/** axe (WCAG 2.1 A/AA): sem violações sérias ou críticas. O "IT" do logotipo (.text-apoio) é excluído: texto de logotipo é isento de contraste. */
export async function semViolacoesAxe(page: Page, rota: string) {
  const r = await new AxeBuilder({ page }).exclude('.text-apoio').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    graves.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ') + ' => ' + n.html.slice(0, 120)).join(' | ')}`),
    `violações axe em ${rota}`,
  ).toEqual([]);
}

/** Texto dos links/botões que já existiam antes do M3 (tela 05 da Sprint 1/2): fora do escopo desta auditoria. */
const ANTERIORES_AO_M3 = ['Minha assinatura', 'Ver planos', 'Membros da Casa', 'Ir para Minha conta'];

/** Alvos de toque de pelo menos 44x44 px (RNF10), só os visíveis e só os criados ou alterados pelo M3. */
export async function alvosDeToqueM3(page: Page, rota: string) {
  const pequenos = await page.evaluate((ignorar) =>
    [...document.querySelectorAll('button,a[href],input[type=radio],input[type=checkbox]')]
      .map((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const t = (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40);
        return { t, w: Math.round(r.width), h: Math.round(r.height), v: r.width > 0 && r.height > 0 && !(el as HTMLElement).hidden };
      })
      .filter((x) => x.v && (x.h < 44 || x.w < 44) && !ignorar.includes(x.t)),
    ANTERIORES_AO_M3);
  expect(pequenos, `alvos de toque < 44px em ${rota}`).toEqual([]);
}
