import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';

export { expect };

/**
 * O front em dev chama /api no próprio Vite, que repassa à API (VITE_API_URL=/api no compose),
 * então o navegador do teste não precisa de redirecionamento nem de ajuste de CORS.
 */
export const test = base;

/** URLs dentro do compose (padrão) ou do host (E2E_API_URL / E2E_MAILPIT_URL). */
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3333';
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? (process.env.E2E_API_URL ? 'http://mailpit:8025' : 'http://localhost:8025');

export const SENHA = 'senha1234';

/** E-mail único por execução (a API é compartilhada e o limite de cadastro é por IP). */
export function emailUnico(prefixo: string) {
  return `${prefixo}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.keepit.test`;
}

/** Cria usuário direto pela API (conta 1 cadastro no rate limit de 10/hora por IP). */
export async function cadastrarPelaApi(request: APIRequestContext, nome: string, email: string, senha = SENHA) {
  const r = await request.post(`${API_URL}/auth/cadastro`, { data: { nome, email, senha, confirmarSenha: senha } });
  expect(r.status(), `cadastro de ${email}: ${await r.text()}`).toBe(201);
  return (await r.json()) as { token: string; usuario: { id: number; email: string } };
}

/** Lê o código de 6 dígitos mais recente enviado a `email` pelo Mailpit. */
export async function lerCodigoNoMailpit(request: APIRequestContext, email: string, assuntoContem?: string): Promise<string> {
  let codigo = '';
  await expect
    .poll(
      async () => {
        const busca = await request.get(`${MAILPIT_URL}/api/v1/search`, { params: { query: `to:${email}`, limit: '10' } });
        if (!busca.ok()) return '';
        const { messages } = (await busca.json()) as { messages: { ID: string; Subject: string }[] };
        const alvo = messages.find((m) => !assuntoContem || m.Subject.includes(assuntoContem));
        if (!alvo) return '';
        const msg = await request.get(`${MAILPIT_URL}/api/v1/message/${alvo.ID}`);
        const { Text } = (await msg.json()) as { Text: string };
        codigo = Text.match(/\b(\d{6})\b/)?.[1] ?? '';
        return codigo;
      },
      { timeout: 15_000, message: `e-mail com código para ${email} não chegou no Mailpit` },
    )
    .toMatch(/^\d{6}$/);
  return codigo;
}

export async function entrar(page: Page, email: string, senha = SENHA) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Entra pela UI e espera a tela 05 (evita navegar antes do login terminar). */
export async function entrarEEsperar(page: Page, email: string, senha = SENHA) {
  await entrar(page, email, senha);
  await expect(page).toHaveURL(/\/inicio$/);
}

/** Digita o código nas 6 caixas (o foco avança sozinho). */
export async function digitarCodigo(page: Page, codigo: string) {
  await page.getByLabel('Dígito 1').click();
  await page.keyboard.type(codigo);
}

export const tokenGuardado = (page: Page) => page.evaluate(() => localStorage.getItem('keepit.token'));

// ---------------------------------------------------------------------------
// Sprint 2 (M5 Planos e Assinatura + M2 Casa e Membros): montagem de cenários pela API.
// Tudo aqui é setup: o que o teste de fluxo valida deve ser feito pela UI.
// ---------------------------------------------------------------------------

export type Papel = 'ADMIN' | 'EDITOR' | 'LEITOR';
export type NomePlano = 'FAMILIA' | 'BUSINESS';

/** Cartões do gateway simulado (docs/adr/0002-m5-m2.md, D5): final 0000 recusa, os demais aprovam. */
export const CARTAO = {
  aprovado: { numero: '4242 4242 4242 4242', validade: '12/39' },
  recusado: { numero: '4111 1100 0005 0000', validade: '12/39' },
};

/** Token da rotina interna (POST /internal/jobs); vem do .env via docker-compose (serviço e2e). */
export const JOBS_TOKEN = process.env.JOBS_TOKEN ?? '';

export interface UsuarioE2E {
  id: number;
  nome: string;
  email: string;
  senha: string;
  token: string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Cria um usuário (já com Casa Individual própria, da qual é ADMIN) pela API. */
export async function criarUsuario(request: APIRequestContext, prefixo = 'usuario', nome?: string): Promise<UsuarioE2E> {
  const email = emailUnico(prefixo);
  const nomeCompleto = nome ?? `${prefixo.charAt(0).toUpperCase()}${prefixo.slice(1)} E2E`;
  const { token, usuario } = await cadastrarPelaApi(request, nomeCompleto, email);
  return { id: usuario.id, nome: nomeCompleto, email, senha: SENHA, token };
}

/** Salva um cartão de teste como método de pagamento do usuário (PUT /pagamento/metodo). */
export async function salvarMetodoPagamento(request: APIRequestContext, usuario: UsuarioE2E, cartao = CARTAO.aprovado) {
  const r = await request.put(`${API_URL}/pagamento/metodo`, { headers: bearer(usuario.token), data: cartao });
  expect(r.status(), `método de pagamento de ${usuario.email}: ${await r.text()}`).toBe(200);
}

/**
 * Contrata um plano pela API (POST /assinaturas). Garante o método de pagamento antes.
 * `confirmaSaidaDaCasa` só importa para EDITOR/LEITOR (tela 24): eles saem da Casa e ganham uma própria.
 * Retorna o corpo 201 `{ assinatura, perfil }`.
 */
export async function contratarPlano(
  request: APIRequestContext,
  usuario: UsuarioE2E,
  plano: NomePlano,
  opcoes: { confirmaSaidaDaCasa?: boolean; cartao?: typeof CARTAO.aprovado } = {},
) {
  await salvarMetodoPagamento(request, usuario, opcoes.cartao);
  const r = await request.post(`${API_URL}/assinaturas`, {
    headers: bearer(usuario.token),
    data: { plano, confirmaSaidaDaCasa: opcoes.confirmaSaidaDaCasa ?? false },
  });
  expect(r.status(), `assinar ${plano} (${usuario.email}): ${await r.text()}`).toBe(201);
  return (await r.json()) as { assinatura: { id: number; status: string; dataRenovacao: string }; perfil: unknown };
}

/** Adiciona um membro à Casa do ADMIN (POST /casa/membros). */
export async function adicionarMembro(request: APIRequestContext, admin: UsuarioE2E, membro: UsuarioE2E, papel: 'EDITOR' | 'LEITOR') {
  const r = await request.post(`${API_URL}/casa/membros`, { headers: bearer(admin.token), data: { email: membro.email, papel } });
  expect(r.status(), `adicionar ${membro.email} como ${papel}: ${await r.text()}`).toBe(201);
}

export interface CasaE2E {
  admin: UsuarioE2E;
  editores: UsuarioE2E[];
  leitores: UsuarioE2E[];
  /** Atalhos para o primeiro de cada papel (undefined se a quantidade pedida foi 0). */
  editor?: UsuarioE2E;
  leitor?: UsuarioE2E;
}

/**
 * Monta uma Casa com papéis pela API: o ADMIN contrata o plano (padrão FAMILIA) e adiciona os membros.
 * `plano: null` mantém a Casa Individual (não comporta membros extras). Cada chamada cria usuários novos,
 * então os testes não dependem uns dos outros. Em fluxos de "outra Casa", chame duas vezes.
 */
export async function montarCasa(
  request: APIRequestContext,
  opcoes: { plano?: NomePlano | null; editores?: number; leitores?: number; prefixo?: string } = {},
): Promise<CasaE2E> {
  const { plano = 'FAMILIA', editores = 1, leitores = 1, prefixo = 'casa' } = opcoes;
  const admin = await criarUsuario(request, `${prefixo}.admin`, 'Admin E2E');
  if (plano) await contratarPlano(request, admin, plano);
  const listaEditores: UsuarioE2E[] = [];
  const listaLeitores: UsuarioE2E[] = [];
  for (let i = 0; i < editores; i++) {
    const u = await criarUsuario(request, `${prefixo}.editor`, `Editor E2E ${i + 1}`);
    await adicionarMembro(request, admin, u, 'EDITOR');
    listaEditores.push(u);
  }
  for (let i = 0; i < leitores; i++) {
    const u = await criarUsuario(request, `${prefixo}.leitor`, `Leitor E2E ${i + 1}`);
    await adicionarMembro(request, admin, u, 'LEITOR');
    listaLeitores.push(u);
  }
  return { admin, editores: listaEditores, leitores: listaLeitores, editor: listaEditores[0], leitor: listaLeitores[0] };
}

/** Dispara a rotina interna (expirar/renovar assinaturas e apagar contas). Falha se JOBS_TOKEN não estiver no ambiente. */
export async function dispararJobs(request: APIRequestContext) {
  expect(JOBS_TOKEN, 'JOBS_TOKEN ausente: rode pelo serviço e2e do compose (make e2e) ou exporte a variável').not.toBe('');
  const r = await request.post(`${API_URL}/internal/jobs`, { headers: { 'x-jobs-token': JOBS_TOKEN } });
  expect(r.status(), `POST /internal/jobs: ${await r.text()}`).toBe(200);
  return (await r.json()) as { expiradas: number; renovadas: number; apagadas: number };
}

/** Lê o perfil (GET /me) do usuário: útil para conferir plano, papel e Casa depois de uma ação pela UI. */
export async function obterPerfil(request: APIRequestContext, usuario: UsuarioE2E) {
  const r = await request.get(`${API_URL}/me`, { headers: bearer(usuario.token) });
  expect(r.status(), `GET /me de ${usuario.email}: ${await r.text()}`).toBe(200);
  return (await r.json()) as Record<string, any>;
}

// ---------------------------------------------------------------------------
// Sprint 3 (M3 Produtos e Tags): montagem de cenários pela API (contrato: docs/api/m3-produtos.md).
// Tudo aqui é setup: o que o teste de fluxo valida deve ser feito pela UI.
// ---------------------------------------------------------------------------

/** Pasta das imagens de teste (geradas por e2e/fixtures/gerar.mjs; veja SETUP.md). */
export const FIXTURES_DIR = `${join(__dirname, '..', 'fixtures')}/`;

/** Imagens de teste e o tipo real de cada uma. `png-renomeado.jpg` é PNG de verdade (vale o tipo real). */
export const FOTOS = {
  jpeg: { arquivo: `${FIXTURES_DIR}foto-valida.jpg`, nome: 'foto-valida.jpg', mime: 'image/jpeg' },
  png: { arquivo: `${FIXTURES_DIR}foto-valida.png`, nome: 'foto-valida.png', mime: 'image/png' },
  pngRenomeado: { arquivo: `${FIXTURES_DIR}png-renomeado.jpg`, nome: 'png-renomeado.jpg', mime: 'image/png' },
  texto: { arquivo: `${FIXTURES_DIR}texto.jpg`, nome: 'texto.jpg', mime: 'image/jpeg' },
  maiorQue5Mb: { arquivo: `${FIXTURES_DIR}foto-maior-que-5mb.jpg`, nome: 'foto-maior-que-5mb.jpg', mime: 'image/jpeg' },
} as const;
export type FotoDeTeste = (typeof FOTOS)[keyof typeof FOTOS];

/** Origem do front (o Vite repassa /s3 ao S3 reescrevendo o Host; ADR 0003 D3). */
const FRONT_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

/** Equivalente de `urlDoS3` do front: troca a origem da URL assinada por `<front>/s3` (válido no host e no container e2e). */
export function urlDoS3(url: string): string {
  const u = new URL(url);
  return `${FRONT_URL}/s3${u.pathname}${u.search}`;
}

export interface TagE2E {
  id: number;
  nome: string;
}

/** Cria uma tag na Casa do usuário (POST /tags). */
export async function criarTag(request: APIRequestContext, usuario: UsuarioE2E, nome: string): Promise<TagE2E> {
  const r = await request.post(`${API_URL}/tags`, { headers: bearer(usuario.token), data: { nome } });
  expect(r.status(), `criar tag "${nome}": ${await r.text()}`).toBe(201);
  return (await r.json()) as TagE2E;
}

/**
 * Envia uma foto pela API: pede a URL assinada, faz o PUT (pelo proxy /s3 do front) e devolve a `chave`.
 * A confirmação acontece ao salvar o produto (POST/PATCH /produtos com `fotos: [{ chave }]`; não existe rota de confirmar).
 * `mime`/`tamanhoBytes` padrão vêm da imagem; passe-os para simular divergências.
 */
export async function enviarFotoPelaApi(
  request: APIRequestContext,
  usuario: UsuarioE2E,
  foto: FotoDeTeste = FOTOS.png,
  opcoes: { mime?: string; tamanhoBytes?: number } = {},
): Promise<{ chave: string }> {
  const corpo = readFileSync(foto.arquivo);
  const pedido = await request.post(`${API_URL}/produtos/fotos/upload-url`, {
    headers: bearer(usuario.token),
    data: { tipo: opcoes.mime ?? foto.mime, tamanhoBytes: opcoes.tamanhoBytes ?? corpo.length },
  });
  expect(pedido.status(), `upload-url de ${foto.nome}: ${await pedido.text()}`).toBe(200);
  const { chave, url, cabecalhos } = (await pedido.json()) as { chave: string; url: string; cabecalhos: Record<string, string> };
  const put = await request.put(urlDoS3(url), { headers: cabecalhos, data: corpo });
  expect(put.status(), `PUT da foto ${foto.nome} no S3: ${await put.text()}`).toBe(200);
  return { chave };
}

export interface DadosProduto {
  nome?: string;
  descricao?: string;
  preco?: string;
  quantidade?: number;
  dataCompra?: string;
  tagIds?: number[];
  /** Fotos de teste a enviar antes de salvar (até 3). */
  fotos?: FotoDeTeste[];
  duplicado?: 'SOMAR' | 'CADASTRAR_MESMO_ASSIM';
  duplicadoId?: number;
}

/** Cria um produto pela API (POST /produtos). Nome padrão único por chamada, para não cair na duplicidade. */
export async function criarProduto(request: APIRequestContext, usuario: UsuarioE2E, dados: DadosProduto = {}) {
  const { fotos = [], ...resto } = dados;
  const chaves: { chave: string }[] = [];
  for (const f of fotos) chaves.push(await enviarFotoPelaApi(request, usuario, f));
  const corpo = {
    nome: `Produto E2E ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    preco: '10.00',
    quantidade: 1,
    dataCompra: '2026-01-15',
    ...resto,
    ...(chaves.length ? { fotos: chaves } : {}),
  };
  const r = await request.post(`${API_URL}/produtos`, { headers: bearer(usuario.token), data: corpo });
  expect([200, 201], `criar produto "${corpo.nome}": ${await r.text()}`).toContain(r.status());
  return (await r.json()) as { resultado: 'CRIADO' | 'QUANTIDADE_SOMADA'; produto: Record<string, any> & { id: number; nome: string } };
}

/** Cria vários produtos de uma vez (cada um com nome único). Útil para testar busca, filtro e paginação. */
export async function criarProdutos(request: APIRequestContext, usuario: UsuarioE2E, quantidade: number, base: DadosProduto = {}) {
  const criados: { id: number; nome: string }[] = [];
  for (let i = 1; i <= quantidade; i++) {
    const { produto } = await criarProduto(request, usuario, { ...base, nome: `${base.nome ?? 'Item'} ${i} ${Date.now()}` });
    criados.push({ id: produto.id, nome: produto.nome });
  }
  return criados;
}

/** Dispara a rotina interna de limpeza (inclui a conciliação de fotos órfãs do S3, quando o backend a expõe). */
export async function limparFotosOrfas(request: APIRequestContext) {
  return (await dispararJobs(request)) as Awaited<ReturnType<typeof dispararJobs>> & { fotosOrfasApagadas?: number };
}

// ---------------------------------------------------------------------------
// Sprint 4 (M4 Estatísticas): Casa com produtos e tags conhecidos, para conferir os números
// (contrato: docs/api/m4-estatisticas.md). Tudo aqui é setup pela API.
// ---------------------------------------------------------------------------

/** Dinheiro do contrato (string "1234.50") para centavos, sem passar por Number de reais. */
export function centavos(valor: string): bigint {
  const [inteiro, dec = '00'] = valor.split('.');
  return BigInt(inteiro) * 100n + BigInt(dec.padEnd(2, '0').slice(0, 2));
}

/** Centavos de volta para o formato do contrato ("1234.50"). */
export function dinheiro(c: bigint): string {
  return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
}

export interface ProdutoConhecido {
  nome: string;
  preco: string;
  quantidade: number;
  /** Dias atrás em que foi comprado (define a ordem dos "mais antigos"). */
  dias: number;
  tags: string[];
}

/**
 * Conjunto padrão, com os números fáceis de conferir à mão:
 * valor total 5754.60, 3 produtos, 45 unidades; tag mais comprada Utilidades (40 un.);
 * Notebook em 2 tags (sobreposição); Caixa sem tag; mais antigo: Notebook.
 */
export const PRODUTOS_CONHECIDOS: ProdutoConhecido[] = [
  { nome: 'Notebook 14 polegadas', preco: '4599.00', quantidade: 1, dias: 30, tags: ['Eletrônicos', 'Garantia'] },
  { nome: 'Pilhas AA (cartela)', preco: '24.90', quantidade: 40, dias: 10, tags: ['Utilidades'] },
  { nome: 'Caixa organizadora', preco: '39.90', quantidade: 4, dias: 8, tags: [] },
];

export interface EstatisticasEsperadas {
  valorTotal: string;
  produtos: number;
  unidades: number;
  /** valorTotal ÷ produtos, 2 casas, meio para cima. */
  valorMedio: string;
  maiorGasto: { nome: string; valor: string } | null;
  tagMaisComprada: { nome: string; unidades: number; produtos: number } | null;
  valorPorTag: { nome: string; valor: string; unidades: number; produtos: number }[];
  semTag: { valor: string; unidades: number; produtos: number } | null;
  /** Do mais antigo para o mais novo (até 5). */
  maisAntigos: string[];
}

/** Calcula, em centavos (BigInt), o que a API deve devolver para uma lista de produtos. Regras: ADR 0004. */
export function calcularEstatisticas(produtos: ProdutoConhecido[]): EstatisticasEsperadas {
  let total = 0n;
  let unidades = 0;
  const porTag = new Map<string, { valor: bigint; unidades: number; produtos: number }>();
  let semTag: { valor: bigint; unidades: number; produtos: number } | null = null;
  let maior: { nome: string; valor: bigint; dias: number } | null = null;
  for (const p of produtos) {
    const valor = centavos(p.preco) * BigInt(p.quantidade);
    total += valor;
    unidades += p.quantidade;
    if (!maior || valor > maior.valor || (valor === maior.valor && p.dias < maior.dias)) maior = { nome: p.nome, valor, dias: p.dias };
    if (p.tags.length === 0) {
      semTag ??= { valor: 0n, unidades: 0, produtos: 0 };
      semTag.valor += valor;
      semTag.unidades += p.quantidade;
      semTag.produtos += 1;
    }
    for (const t of p.tags) {
      const l = porTag.get(t) ?? { valor: 0n, unidades: 0, produtos: 0 };
      l.valor += valor;
      l.unidades += p.quantidade;
      l.produtos += 1;
      porTag.set(t, l);
    }
  }
  const linhas = [...porTag.entries()].map(([nome, l]) => ({ nome, ...l }));
  // Tag mais comprada: mais unidades; empate: mais produtos; depois nome A-Z.
  const campea = [...linhas].sort(
    (a, b) => b.unidades - a.unidades || b.produtos - a.produtos || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }),
  )[0];
  const n = BigInt(produtos.length);
  const medio = n === 0n ? 0n : (total * 2n + n) / (n * 2n); // meio para cima
  return {
    valorTotal: dinheiro(total),
    produtos: produtos.length,
    unidades,
    valorMedio: dinheiro(medio),
    maiorGasto: maior ? { nome: maior.nome, valor: dinheiro(maior.valor) } : null,
    tagMaisComprada: campea ? { nome: campea.nome, unidades: campea.unidades, produtos: campea.produtos } : null,
    valorPorTag: linhas
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((l) => ({ nome: l.nome, valor: dinheiro(l.valor), unidades: l.unidades, produtos: l.produtos })),
    semTag: semTag ? { valor: dinheiro(semTag.valor), unidades: semTag.unidades, produtos: semTag.produtos } : null,
    maisAntigos: [...produtos].sort((a, b) => b.dias - a.dias).slice(0, 5).map((p) => p.nome),
  };
}

function dataDiasAtras(dias: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

export interface CasaComProdutos extends CasaE2E {
  produtos: ProdutoConhecido[];
  tags: Record<string, TagE2E>;
  /** Números que a API deve devolver (calculados em centavos, independentes do backend). */
  esperado: EstatisticasEsperadas;
}

/**
 * Monta uma Casa (papéis como em `montarCasa`) com `produtos` e as tags citadas por eles.
 * Os nomes dos produtos e das tags são os informados (cada Casa é nova, então não há duplicidade).
 * Padrão: PRODUTOS_CONHECIDOS. Passe `produtos: []` para uma Casa vazia (estado vazio, sem divisão por zero).
 */
export async function montarCasaComProdutos(
  request: APIRequestContext,
  opcoes: { produtos?: ProdutoConhecido[]; plano?: NomePlano | null; editores?: number; leitores?: number; prefixo?: string } = {},
): Promise<CasaComProdutos> {
  const { produtos = PRODUTOS_CONHECIDOS, ...resto } = opcoes;
  const casa = await montarCasa(request, { prefixo: 'estat', ...resto });
  const tags: Record<string, TagE2E> = {};
  for (const nome of [...new Set(produtos.flatMap((p) => p.tags))]) tags[nome] = await criarTag(request, casa.admin, nome);
  for (const p of produtos) {
    await criarProduto(request, casa.admin, {
      nome: p.nome,
      preco: p.preco,
      quantidade: p.quantidade,
      dataCompra: dataDiasAtras(p.dias),
      tagIds: p.tags.map((t) => tags[t].id),
    });
  }
  return { ...casa, produtos, tags, esperado: calcularEstatisticas(produtos) };
}
