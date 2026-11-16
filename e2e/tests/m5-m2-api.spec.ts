import type { APIRequestContext } from '@playwright/test';
import {
  API_URL, CARTAO, JOBS_TOKEN, adicionarMembro, bearer, contratarPlano, criarUsuario, dispararJobs, expect, montarCasa,
  obterPerfil, salvarMetodoPagamento, test, type UsuarioE2E,
} from './helpers';

// Matriz de papéis (RNF31), códigos HTTP, corpo de erro e IDOR das rotas novas da Sprint 2 (contratos m5-assinatura.md e m2-casa.md).

type Quem = 'semToken' | 'ADMIN' | 'EDITOR' | 'LEITOR' | 'outraCasa';
type Chamada = (token: string | undefined, quem: Quem) => Promise<{ status: () => number; json: () => Promise<any> }>;

async function matriz(
  fabrica: () => Promise<{ admin: UsuarioE2E; editor: UsuarioE2E; leitor: UsuarioE2E; outro: UsuarioE2E }>,
  chamar: (quem: Quem, tokens: Record<Quem, string | undefined>, ctx: { admin: UsuarioE2E; editor: UsuarioE2E; leitor: UsuarioE2E; outro: UsuarioE2E }) => Promise<{ status: () => number }>,
  esperados: Record<Quem, number>,
) {
  for (const quem of ['semToken', 'LEITOR', 'EDITOR', 'ADMIN', 'outraCasa'] as Quem[]) {
    const ctx = await fabrica(); // Casa nova por linha: rotas destrutivas não contaminam as outras linhas
    const tokens: Record<Quem, string | undefined> = {
      semToken: undefined, ADMIN: ctx.admin.token, EDITOR: ctx.editor.token, LEITOR: ctx.leitor.token, outraCasa: ctx.outro.token,
    };
    const r = await chamar(quem, tokens, ctx);
    expect(r.status(), `papel ${quem}`).toBe(esperados[quem]);
  }
}

async function cenario(request: APIRequestContext, plano: 'FAMILIA' | 'BUSINESS' | null = 'FAMILIA') {
  const c = await montarCasa(request, { plano, editores: plano ? 1 : 0, leitores: plano ? 1 : 0 });
  const outro = await criarUsuario(request, 'outra');
  await contratarPlano(request, outro, 'FAMILIA');
  return { admin: c.admin, editor: c.editor!, leitor: c.leitor!, outro };
}
const h = (t?: string) => (t ? bearer(t) : {});

test.describe('API: erros e autenticação', () => {
  test('rotas novas sem token ou com token inválido: 401 NAO_AUTENTICADO no formato { error, message }', async ({ request }) => {
    const rotas: [string, string][] = [
      ['get', '/planos'], ['get', '/pagamento/metodo'], ['put', '/pagamento/metodo'], ['post', '/assinaturas'],
      ['get', '/assinaturas/atual'], ['post', '/assinaturas/atual/cancelar'], ['post', '/assinaturas/atual/reativar'],
      ['get', '/casa/membros'], ['post', '/casa/membros'], ['patch', '/casa/membros/1'], ['delete', '/casa/membros/1'], ['patch', '/casa'],
    ];
    for (const [m, url] of rotas) {
      for (const headers of [{}, { Authorization: 'Bearer lixo.lixo.lixo' }]) {
        const r = await (request as any)[m](`${API_URL}${url}`, { headers, data: m === 'get' || m === 'delete' ? undefined : {} });
        expect(r.status(), `${m} ${url}`).toBe(401);
        const corpo = await r.json();
        expect(corpo.error, `${m} ${url}`).toMatch(/NAO_AUTENTICADO|SESSAO_EXPIRADA/);
        expect(typeof corpo.message).toBe('string');
      }
    }
  });

  test('POST /internal/jobs: sem chave ou com token de usuário dá 401; com a chave devolve { expiradas, renovadas, apagadas, falhas, fotosOrfasApagadas, fotosOrfasPendentes }', async ({ request }) => {
    const u = await criarUsuario(request);
    expect((await request.post(`${API_URL}/internal/jobs`)).status()).toBe(401);
    expect((await request.post(`${API_URL}/internal/jobs`, { headers: bearer(u.token) })).status()).toBe(401);
    expect((await request.post(`${API_URL}/internal/jobs`, { headers: { 'x-jobs-token': 'errado' } })).status()).toBe(401);
    const r = await dispararJobs(request);
    expect(Object.keys(r).sort()).toEqual(['apagadas', 'expiradas', 'falhas', 'fotosOrfasApagadas', 'fotosOrfasPendentes', 'renovadas']);
    expect(JOBS_TOKEN).not.toBe('');
  });
});

test.describe('API M5: matriz de papéis', () => {
  test('GET /planos: 401/200/200/200/200 e plano vigente da Casa', async ({ request }) => {
    await matriz(() => cenario(request), (q, t) => request.get(`${API_URL}/planos`, { headers: h(t[q]) }), { semToken: 401, LEITOR: 200, EDITOR: 200, ADMIN: 200, outraCasa: 200 });
    const c = await cenario(request);
    const corpo = await (await request.get(`${API_URL}/planos`, { headers: bearer(c.editor.token) })).json();
    expect(corpo.planos.map((p: any) => p.nome)).toEqual(['INDIVIDUAL', 'FAMILIA', 'BUSINESS']);
    expect(corpo.planoAtual).toBe('FAMILIA');
    expect(corpo.assinatura.status).toBe('ATIVA');
  });

  test('GET e PUT /pagamento/metodo: 401/200 para todos os papéis, sempre o do próprio usuário', async ({ request }) => {
    await matriz(() => cenario(request), (q, t) => request.get(`${API_URL}/pagamento/metodo`, { headers: h(t[q]) }), { semToken: 401, LEITOR: 200, EDITOR: 200, ADMIN: 200, outraCasa: 200 });
    await matriz(() => cenario(request), (q, t) => request.put(`${API_URL}/pagamento/metodo`, { headers: h(t[q]), data: CARTAO.aprovado }), { semToken: 401, LEITOR: 200, EDITOR: 200, ADMIN: 200, outraCasa: 200 });
  });

  test('POST /assinaturas: 401/201/201/201/201 (membro com aviso confirmado)', async ({ request }) => {
    await matriz(
      async () => {
        const c = await cenario(request);
        for (const u of [c.admin, c.editor, c.leitor, c.outro]) await salvarMetodoPagamento(request, u);
        return c;
      },
      (q, t) => request.post(`${API_URL}/assinaturas`, { headers: h(t[q]), data: { plano: 'BUSINESS', confirmaSaidaDaCasa: true } }),
      { semToken: 401, LEITOR: 201, EDITOR: 201, ADMIN: 201, outraCasa: 201 },
    );
  });

  for (const [metodo, caminho] of [['get', '/assinaturas/atual'], ['post', '/assinaturas/atual/cancelar'], ['post', '/assinaturas/atual/reativar']] as const) {
    test(`${metodo.toUpperCase()} ${caminho}: só ADMIN (401/403/403/ADMIN)`, async ({ request }) => {
      // reativar de uma ATIVA é 409 (estado), cancelar/atual são 200: o que importa é a barreira de papel.
      const adminOk = caminho.endsWith('reativar') ? 409 : 200;
      await matriz(() => cenario(request), (q, t) => (request as any)[metodo](`${API_URL}${caminho}`, { headers: h(t[q]) }), {
        semToken: 401, LEITOR: 403, EDITOR: 403, ADMIN: adminOk, outraCasa: adminOk,
      });
    });
  }

  test('403 e 401 trazem { error, message } e LEITOR/EDITOR não alteram a assinatura da Casa', async ({ request }) => {
    const c = await cenario(request);
    const r = await request.post(`${API_URL}/assinaturas/atual/cancelar`, { headers: bearer(c.leitor.token) });
    const corpo = await r.json();
    expect(corpo).toMatchObject({ error: 'SEM_PERMISSAO' });
    expect(typeof corpo.message).toBe('string');
    const ver = await (await request.get(`${API_URL}/assinaturas/atual`, { headers: bearer(c.admin.token) })).json();
    expect(ver.assinatura.status).toBe('ATIVA');
  });
});

test.describe('API M5: erros do contrato', () => {
  test('POST /assinaturas: 422 de corpo, aviso, método ausente; 409 mesmo plano; 402 recusado sem efeitos', async ({ request }) => {
    const admin = await criarUsuario(request, 'sub');
    const post = (u: UsuarioE2E, data: unknown) => request.post(`${API_URL}/assinaturas`, { headers: bearer(u.token), data });
    for (const corpo of [{}, { plano: 'INDIVIDUAL' }, { plano: 'XPTO' }, { plano: 'FAMILIA', confirmaSaidaDaCasa: 'sim' }]) {
      const r = await post(admin, corpo);
      expect(r.status(), JSON.stringify(corpo)).toBe(422);
      expect((await r.json()).error).toBe('DADOS_INVALIDOS');
    }
    let r = await post(admin, { plano: 'FAMILIA' });
    expect(r.status()).toBe(422);
    expect((await r.json()).error).toBe('METODO_PAGAMENTO_AUSENTE');

    // Recusa: cartão final 0000, nada muda
    await salvarMetodoPagamento(request, admin, CARTAO.recusado);
    r = await post(admin, { plano: 'FAMILIA' });
    expect(r.status()).toBe(402);
    expect((await r.json()).error).toBe('PAGAMENTO_RECUSADO');
    expect((await obterPerfil(request, admin)).plano.nome).toBe('INDIVIDUAL');

    await salvarMetodoPagamento(request, admin, CARTAO.aprovado);
    r = await post(admin, { plano: 'FAMILIA' });
    expect(r.status()).toBe(201);
    const corpo = await r.json();
    expect(corpo.assinatura.status).toBe('ATIVA');
    expect(corpo.perfil.plano.nome).toBe('FAMILIA');
    r = await post(admin, { plano: 'FAMILIA' });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toBe('ESTADO_INVALIDO');
  });

  test('membro sem confirmaSaidaDaCasa: 422 AVISO_NAO_CONFIRMADO e nada muda', async ({ request }) => {
    const c = await montarCasa(request, { editores: 0, leitores: 1 });
    await salvarMetodoPagamento(request, c.leitor!);
    for (const data of [{ plano: 'BUSINESS' }, { plano: 'BUSINESS', confirmaSaidaDaCasa: false }]) {
      const r = await request.post(`${API_URL}/assinaturas`, { headers: bearer(c.leitor!.token), data });
      expect(r.status()).toBe(422);
      expect((await r.json()).error).toBe('AVISO_NAO_CONFIRMADO');
    }
    const p = await obterPerfil(request, c.leitor!);
    expect(p.papel).toBe('LEITOR');
  });

  test('PUT /pagamento/metodo: 422 DADOS_INVALIDOS (Luhn, validade, PAN real, só cartões de teste)', async ({ request }) => {
    const u = await criarUsuario(request, 'cartao');
    const casos: [string, any][] = [
      ['numero', { numero: '4242 4242 4242 4241', validade: '12/39' }],
      ['validade', { numero: '4242 4242 4242 4242', validade: '01/20' }],
      ['numero', { numero: '5555 5555 5555 4444', validade: '12/39' }],
    ];
    for (const [campo, data] of casos) {
      const r = await request.put(`${API_URL}/pagamento/metodo`, { headers: bearer(u.token), data });
      expect(r.status(), campo).toBe(422);
      const corpo = await r.json();
      expect(corpo.error).toBe('DADOS_INVALIDOS');
      expect(JSON.stringify(corpo.details)).toContain(campo);
    }
  });

  test('Reteste: nome e CVV enviados são ignorados e não voltam na resposta', async ({ request }) => {
    const u = await criarUsuario(request, 'ignora');
    const r = await request.put(`${API_URL}/pagamento/metodo`, { headers: bearer(u.token), data: { ...CARTAO.aprovado, nome: 'ANA SOUZA', cvv: '123' } });
    expect(r.status()).toBe(200);
    const t = await r.text();
    expect(t).not.toContain('ANA');
    expect(t).not.toContain('123');
  });

  test('PUT /pagamento/metodo devolve só marca e 4 últimos dígitos (RNF04)', async ({ request }) => {
    const u = await criarUsuario(request, 'pan');
    const r = await request.put(`${API_URL}/pagamento/metodo`, { headers: bearer(u.token), data: CARTAO.aprovado });
    const texto = await r.text();
    expect(JSON.parse(texto).metodo).toMatchObject({ marca: 'VISA', ultimos4: '4242' });
    for (const proibido of ['4242 4242', '42424242', '12/39', 'USUARIO E2E', '"123"']) expect(texto).not.toContain(proibido);
    const g = await (await request.get(`${API_URL}/pagamento/metodo`, { headers: bearer(u.token) })).text();
    expect(g).not.toContain('42424242');
  });

  test('cancelar e reativar: ATIVA -> CANCELADA (benefícios mantidos) -> ATIVA; estados inválidos dão 409; motivo longo 422', async ({ request }) => {
    const c = await cenario(request);
    const t = bearer(c.admin.token);
    expect((await request.post(`${API_URL}/assinaturas/atual/reativar`, { headers: t })).status()).toBe(409);
    expect((await request.post(`${API_URL}/assinaturas/atual/cancelar`, { headers: t, data: { motivo: 'x'.repeat(2000) } })).status()).toBe(422);
    let r = await request.post(`${API_URL}/assinaturas/atual/cancelar`, { headers: t, data: { motivo: 'caro' } });
    expect(r.status()).toBe(200);
    let a = (await r.json()).assinatura;
    expect(a.status).toBe('CANCELADA');
    expect(a.podeReativar).toBe(true);
    expect(a.dataCancelamento).not.toBeNull();
    const p = await obterPerfil(request, c.admin);
    expect(p.plano.nome).toBe('FAMILIA'); // benefícios até a renovação
    expect(p.assinatura.status).toBe('CANCELADA');
    expect((await request.post(`${API_URL}/assinaturas/atual/cancelar`, { headers: t })).status()).toBe(409);
    r = await request.post(`${API_URL}/assinaturas/atual/reativar`, { headers: t });
    expect(r.status()).toBe(200);
    a = (await r.json()).assinatura;
    expect(a.status).toBe('ATIVA');
    expect(a.dataCancelamento).toBeNull();
  });

  test('Casa Individual: GET /assinaturas/atual 200 com assinatura null; cancelar e reativar 409', async ({ request }) => {
    const u = await criarUsuario(request, 'indiv');
    const r = await request.get(`${API_URL}/assinaturas/atual`, { headers: bearer(u.token) });
    expect(r.status()).toBe(200);
    expect((await r.json()).assinatura).toBeNull();
    expect((await request.post(`${API_URL}/assinaturas/atual/cancelar`, { headers: bearer(u.token) })).status()).toBe(409);
    expect((await request.post(`${API_URL}/assinaturas/atual/reativar`, { headers: bearer(u.token) })).status()).toBe(409);
  });

  test('duplo clique em POST /assinaturas: no máximo uma assinatura vigente (201 + 409)', async ({ request }) => {
    const u = await criarUsuario(request, 'duplo');
    await salvarMetodoPagamento(request, u);
    const rs = await Promise.all([1, 2].map(() => request.post(`${API_URL}/assinaturas`, { headers: bearer(u.token), data: { plano: 'FAMILIA' } })));
    expect(rs.map((r) => r.status()).sort()).toEqual([201, 409]);
  });
});

test.describe('API M2: matriz de papéis e IDOR', () => {
  test('GET /casa/membros: 401/200 para todos; outra Casa vê só a própria lista; ordem ADMIN primeiro', async ({ request }) => {
    await matriz(() => cenario(request), (q, t) => request.get(`${API_URL}/casa/membros`, { headers: h(t[q]) }), { semToken: 401, LEITOR: 200, EDITOR: 200, ADMIN: 200, outraCasa: 200 });
    const c = await cenario(request);
    const corpo = await (await request.get(`${API_URL}/casa/membros`, { headers: bearer(c.leitor.token) })).json();
    expect(corpo.membros.map((m: any) => m.papel)).toEqual(['ADMIN', 'EDITOR', 'LEITOR']);
    expect(corpo.membrosEmUso).toBe(3);
    expect(corpo.limiteMembros).toBe(6);
    expect(corpo.plano.nome).toBe('FAMILIA');
    expect(JSON.stringify(corpo)).not.toMatch(/senha|hash/i);
    expect(corpo.membros.some((m: any) => m.email === c.outro.email)).toBe(false);
  });

  test('POST /casa/membros: 401/403/403/201/201', async ({ request }) => {
    await matriz(
      async () => {
        const c = await cenario(request);
        return c;
      },
      async (q, t, ctx) => {
        const novo = await criarUsuario(request, 'alvo');
        return request.post(`${API_URL}/casa/membros`, { headers: h(t[q]), data: { email: novo.email, papel: 'LEITOR' } });
      },
      { semToken: 401, LEITOR: 403, EDITOR: 403, ADMIN: 201, outraCasa: 201 },
    );
  });

  test('PATCH /casa/membros/:id: 401/403/403/200 e ADMIN de outra Casa 404 (IDOR)', async ({ request }) => {
    await matriz(() => cenario(request), (q, t, ctx) => request.patch(`${API_URL}/casa/membros/${ctx.leitor.id}`, { headers: h(t[q]), data: { papel: 'EDITOR' } }), { semToken: 401, LEITOR: 403, EDITOR: 403, ADMIN: 200, outraCasa: 404 });
  });

  test('DELETE /casa/membros/:id: 401/403/403/204 e ADMIN de outra Casa 404 (IDOR)', async ({ request }) => {
    await matriz(() => cenario(request), (q, t, ctx) => request.delete(`${API_URL}/casa/membros/${ctx.leitor.id}`, { headers: h(t[q]) }), { semToken: 401, LEITOR: 403, EDITOR: 403, ADMIN: 204, outraCasa: 404 });
  });

  test('PATCH /casa: 401/403/403/200/200 e o id da Casa no corpo é ignorado', async ({ request }) => {
    await matriz(() => cenario(request), (q, t) => request.patch(`${API_URL}/casa`, { headers: h(t[q]), data: { nome: 'Casa Nova' } }), { semToken: 401, LEITOR: 403, EDITOR: 403, ADMIN: 200, outraCasa: 200 });
    const c = await cenario(request);
    const pOutro = await obterPerfil(request, c.outro);
    const r = await request.patch(`${API_URL}/casa`, { headers: bearer(c.admin.token), data: { nome: 'Minha', id: pOutro.casa.id, casaId: pOutro.casa.id } });
    expect(r.status()).toBe(200);
    expect((await obterPerfil(request, c.outro)).casa.nome).toBe(pOutro.casa.nome);
    expect((await obterPerfil(request, c.admin)).casa.nome).toBe('Minha');
  });

  test('IDOR: remover/alterar usuário de outra Casa ou inexistente dá 404 NAO_ENCONTRADO sem efeito', async ({ request }) => {
    const c = await cenario(request);
    const alvos = [c.outro.id, 999999999];
    for (const id of alvos) {
      let r = await request.patch(`${API_URL}/casa/membros/${id}`, { headers: bearer(c.admin.token), data: { papel: 'EDITOR' } });
      expect(r.status()).toBe(404);
      expect((await r.json()).error).toBe('NAO_ENCONTRADO');
      r = await request.delete(`${API_URL}/casa/membros/${id}`, { headers: bearer(c.admin.token) });
      expect(r.status()).toBe(404);
    }
    const p = await obterPerfil(request, c.outro);
    expect(p.papel).toBe('ADMIN');
    expect(p.casa.totalMembros).toBe(1);
  });

  test('erros de M2: 422 de id/papel/nome, 409 ADMIN alvo, 404 e-mail sem conta, 409 já na Casa', async ({ request }) => {
    const c = await cenario(request);
    const t = bearer(c.admin.token);
    for (const id of ['abc', '0', '-1', '1.5']) {
      expect((await request.patch(`${API_URL}/casa/membros/${id}`, { headers: t, data: { papel: 'EDITOR' } })).status(), `PATCH ${id}`).toBe(422);
      expect((await request.delete(`${API_URL}/casa/membros/${id}`, { headers: t })).status(), `DELETE ${id}`).toBe(422);
    }
    for (const papel of ['ADMIN', 'XPTO', undefined]) {
      const r = await request.patch(`${API_URL}/casa/membros/${c.leitor.id}`, { headers: t, data: { papel } });
      expect(r.status(), String(papel)).toBe(422);
      expect((await r.json()).error).toBe('DADOS_INVALIDOS');
    }
    let r = await request.patch(`${API_URL}/casa/membros/${c.admin.id}`, { headers: t, data: { papel: 'LEITOR' } });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toBe('ESTADO_INVALIDO');
    r = await request.delete(`${API_URL}/casa/membros/${c.admin.id}`, { headers: t });
    expect(r.status()).toBe(409);
    for (const nome of ['', '   ', 'a'.repeat(81), '<script>']) {
      r = await request.patch(`${API_URL}/casa`, { headers: t, data: { nome } });
      expect(r.status(), `nome "${nome.slice(0, 10)}"`).toBe(422);
      expect(JSON.stringify((await r.json()).details)).toContain('nome');
    }
    // POST /casa/membros
    r = await request.post(`${API_URL}/casa/membros`, { headers: t, data: { email: 'invalido' } });
    expect(r.status()).toBe(422);
    r = await request.post(`${API_URL}/casa/membros`, { headers: t, data: { email: 'x@e2e.keepit.test', papel: 'ADMIN' } });
    expect(r.status()).toBe(422);
    r = await request.post(`${API_URL}/casa/membros`, { headers: t, data: { email: 'naoexiste.zzz@e2e.keepit.test' } });
    expect(r.status()).toBe(404);
    expect((await r.json()).error).toBe('USUARIO_NAO_ENCONTRADO');
    r = await request.post(`${API_URL}/casa/membros`, { headers: t, data: { email: c.leitor.email.toUpperCase() } });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toBe('MEMBRO_JA_NA_CASA');
    r = await request.post(`${API_URL}/casa/membros`, { headers: t, data: { email: c.admin.email } });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toBe('MEMBRO_JA_NA_CASA');
  });

  test('MEMBRO_NAO_TRANSFERIVEL: ADMIN com membros e titular de assinatura; sem details', async ({ request }) => {
    const c = await cenario(request);
    const t = bearer(c.admin.token);
    for (const alvo of [c.outro]) {
      const r = await request.post(`${API_URL}/casa/membros`, { headers: t, data: { email: alvo.email } });
      expect(r.status()).toBe(409);
      const corpo = await r.json();
      expect(corpo.error).toBe('MEMBRO_NAO_TRANSFERIVEL');
      expect(corpo.details).toBeUndefined();
    }
  });

  test('limite do plano: Individual não comporta 2º membro; Família para no 6º (LIMITE_MEMBROS com details); remover libera vaga', async ({ request }) => {
    const solo = await criarUsuario(request, 'solo');
    const alvo = await criarUsuario(request, 'alvo');
    let r = await request.post(`${API_URL}/casa/membros`, { headers: bearer(solo.token), data: { email: alvo.email } });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toBe('LIMITE_MEMBROS');

    const c = await montarCasa(request, { plano: 'FAMILIA', editores: 2, leitores: 3 }); // 1 + 5 = 6
    const extra = await criarUsuario(request, 'extra');
    r = await request.post(`${API_URL}/casa/membros`, { headers: bearer(c.admin.token), data: { email: extra.email } });
    expect(r.status()).toBe(409);
    const corpo = await r.json();
    expect(corpo.error).toBe('LIMITE_MEMBROS');
    expect(corpo.details).toMatchObject({ limiteMembros: 6, membrosEmUso: 6 });
    expect((await request.delete(`${API_URL}/casa/membros/${c.leitores[0].id}`, { headers: bearer(c.admin.token) })).status()).toBe(204);
    await adicionarMembro(request, c.admin, extra, 'LEITOR');
  });

  test('papel e Casa mudam para o mesmo token na próxima requisição; removido vira ADMIN de Casa Individual', async ({ request }) => {
    const c = await montarCasa(request, { editores: 1, leitores: 1 });
    const t = bearer(c.admin.token);
    // LEITOR promovido a EDITOR passa a ter acesso de EDITOR (ex.: nenhuma rota de admin) e GET /me reflete
    expect((await request.patch(`${API_URL}/casa/membros/${c.leitor!.id}`, { headers: t, data: { papel: 'EDITOR' } })).status()).toBe(200);
    expect((await obterPerfil(request, c.leitor!)).papel).toBe('EDITOR');
    // remoção
    expect((await request.delete(`${API_URL}/casa/membros/${c.leitor!.id}`, { headers: t })).status()).toBe(204);
    const p = await obterPerfil(request, c.leitor!);
    expect(p).toMatchObject({ papel: 'ADMIN' });
    expect(p.plano.nome).toBe('INDIVIDUAL');
    expect(p.assinatura).toBeNull();
    expect(p.casa.totalMembros).toBe(1);
    // e agora ele tem acesso de ADMIN na Casa nova
    expect((await request.get(`${API_URL}/assinaturas/atual`, { headers: bearer(c.leitor!.token) })).status()).toBe(200);
  });

  test('transferência: EDITOR de outra Casa é adicionado e sai da anterior; ADMIN solo sem assinatura é transferível', async ({ request }) => {
    const a = await montarCasa(request, { editores: 1, leitores: 0 });
    const b = await montarCasa(request, { prefixo: 'dest', editores: 0, leitores: 0 });
    await adicionarMembro(request, b.admin, a.editor!, 'LEITOR');
    expect((await obterPerfil(request, a.editor!)).casa.id).toBe((await obterPerfil(request, b.admin)).casa.id);
    expect((await obterPerfil(request, a.admin)).casa.totalMembros).toBe(1);
    const solo = await criarUsuario(request, 'transf');
    await adicionarMembro(request, b.admin, solo, 'EDITOR');
    expect((await obterPerfil(request, solo)).papel).toBe('EDITOR');
  });
});

test.describe('API M5: encaixe no plano', () => {
  test('Business com 7 membros não troca para Família: 422 PLANO_NAO_COMPORTA com details e nada muda', async ({ request }) => {
    const c = await montarCasa(request, { plano: 'BUSINESS', editores: 3, leitores: 3 }); // 1 + 6 = 7 > 6
    await salvarMetodoPagamento(request, c.admin);
    const r = await request.post(`${API_URL}/assinaturas`, { headers: bearer(c.admin.token), data: { plano: 'FAMILIA' } });
    expect(r.status()).toBe(422);
    const corpo = await r.json();
    expect(corpo.error).toBe('PLANO_NAO_COMPORTA');
    expect(corpo.details.violacoes).toEqual([{ limite: 'MEMBROS', atual: 7, maximo: 6 }]);
    expect((await obterPerfil(request, c.admin)).plano.nome).toBe('BUSINESS');
  });
});

test.describe('API: rotina e exclusão de conta', () => {
  test('expiração: CANCELADA vencida só expira depois de dataRenovacao (job não expira a vigente)', async ({ request }) => {
    const c = await montarCasa(request, { editores: 1, leitores: 0 });
    await request.post(`${API_URL}/assinaturas/atual/cancelar`, { headers: bearer(c.admin.token) });
    await dispararJobs(request);
    // ainda vigente, benefícios mantidos até a renovação
    const p = await obterPerfil(request, c.admin);
    expect(p.plano.nome).toBe('FAMILIA');
    expect((await obterPerfil(request, c.editor!)).casa.id).toBe(p.casa.id);
  });

  test('exclusão de conta do ADMIN com membros: herdeiro (EDITOR) promovido mantém a Casa; demais ganham Casa própria', async ({ request }) => {
    const c = await montarCasa(request, { editores: 1, leitores: 1 });
    const casaId = (await obterPerfil(request, c.admin)).casa.id;
    const r = await request.delete(`${API_URL}/me`, { headers: bearer(c.admin.token), data: { senha: c.admin.senha } });
    expect(r.status(), await r.text()).toBeLessThan(300);
    const herdeiro = await obterPerfil(request, c.editor!);
    expect(herdeiro.papel).toBe('ADMIN');
    expect(herdeiro.casa.id).toBe(casaId);
    expect(herdeiro.plano.nome).toBe('INDIVIDUAL');
    expect(herdeiro.assinatura).toBeNull();
    const outro = await obterPerfil(request, c.leitor!);
    expect(outro.papel).toBe('ADMIN');
    expect(outro.casa.id).not.toBe(casaId);
    await dispararJobs(request); // titularId nulo não pode quebrar o apagamento (ACH-08)
  });
});
