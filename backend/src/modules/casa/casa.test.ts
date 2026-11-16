import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { caixaDeSaida } from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';
import { hashSenha } from '../../lib/senha.js';
import { autorizacao, criarAssinaturaDeTeste, montarCasa, testarMatrizDePapeis, type CasaDeTeste } from '../../test/casa.js';
import { limparBanco } from '../../test/db.js';
import { apagarContasVencidas } from '../auth/auth.service.js';
import { tratarExclusaoDeConta } from './membros.service.js';

const SENHA = 'senha-segura-1';

beforeEach(async () => {
  await limparBanco();
  caixaDeSaida.length = 0;
});
afterEach(() => {
  delete process.env.TESTAR_RATE_LIMIT;
});
afterAll(() => prisma.$disconnect());

const get = (url: string, token?: string) => request(app).get(url).set(...autorizacao(token));
const post = (url: string, token: string | undefined, corpo?: object) =>
  request(app).post(url).set(...autorizacao(token)).send(corpo);
const patch = (url: string, token: string | undefined, corpo?: object) =>
  request(app).patch(url).set(...autorizacao(token)).send(corpo);
const del = (url: string, token?: string, corpo?: object) =>
  request(app).delete(url).set(...autorizacao(token)).send(corpo);

/** Invariante (ADR 0002, I2): toda Casa existente tem exatamente um ADMIN e todo usuário tem Casa. */
async function conferirInvariantes() {
  const casas = await prisma.casa.findMany({ include: { membros: true } });
  for (const c of casas) {
    expect(c.membros.filter((m) => m.papel === 'ADMIN'), `Casa ${c.id} sem exatamente 1 ADMIN`).toHaveLength(1);
  }
}

async function criarProduto(casaId: number, adicionadoPorId: number | null, nome = 'Geladeira') {
  return prisma.produto.create({
    data: { casaId, adicionadoPorId, nome, preco: '1000.00', dataCompra: new Date() },
  });
}

async function usuarioSolo(prefixo = 'solo') {
  return montarCasa({ editores: 0, leitores: 0, prefixo });
}

// ---------------------------------------------------------------------------------------------------------------
describe('GET /casa/membros', () => {
  it('matriz de papéis: todos da Casa leem; sem token 401; ADMIN de outra Casa lê a dele', async () => {
    const casa = await montarCasa();
    await testarMatrizDePapeis(casa, (t) => get('/casa/membros', t), {
      semToken: 401, LEITOR: 200, EDITOR: 200, outraCasa: 200, ADMIN: 200,
    });
  });

  it('devolve Casa, plano, limite e membros (ADMIN primeiro, depois por entrada); nunca senhaHash', async () => {
    const casa = await montarCasa({ editores: 1, leitores: 1, assinatura: 'FAMILIA' });
    // O LEITOR entrou antes do EDITOR: a ordem é por entrada, com o ADMIN sempre primeiro.
    await prisma.membro.update({
      where: { usuarioId: casa.leitor!.usuario.id },
      data: { entrouEm: new Date(Date.now() - 86_400_000) },
    });
    const res = await get('/casa/membros', casa.admin.token);
    expect(res.status).toBe(200);
    expect(res.body.plano).toMatchObject({ nome: 'FAMILIA', limiteMembros: 6 });
    expect(res.body.assinatura).toMatchObject({ status: 'ATIVA' });
    expect(res.body).toMatchObject({ limiteMembros: 6, membrosEmUso: 3 });
    expect(res.body.membros.map((m: { papel: string }) => m.papel)).toEqual(['ADMIN', 'LEITOR', 'EDITOR']);
    expect(res.body.membros[0]).toMatchObject({ usuarioId: casa.admin.usuario.id, email: casa.admin.usuario.email });
    expect(JSON.stringify(res.body)).not.toContain('senha');
  });

  it('minimização (LGPD): o e-mail dos membros só vai para o ADMIN; EDITOR e LEITOR não o recebem', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    const doAdmin = await get('/casa/membros', casa.admin.token);
    expect(doAdmin.body.membros.every((m: { email?: string }) => typeof m.email === 'string')).toBe(true);
    for (const quem of [casa.editor!, casa.leitor!]) {
      const r = await get('/casa/membros', quem.token);
      expect(r.status).toBe(200);
      expect(r.body.membros).toHaveLength(3);
      for (const m of r.body.membros) expect(m).not.toHaveProperty('email');
      expect(JSON.stringify(r.body)).not.toContain('@');
    }
  });

  it('Casa Individual: assinatura nula e limite 1; não vaza membros de outra Casa', async () => {
    const a = await montarCasa({ editores: 0, leitores: 0 });
    await montarCasa({ editores: 2, leitores: 2 });
    const res = await get('/casa/membros', a.admin.token);
    expect(res.body.assinatura).toBeNull();
    expect(res.body).toMatchObject({ limiteMembros: 1, membrosEmUso: 1 });
    expect(res.body.membros).toHaveLength(1);
    expect(res.body.casa.id).toBe(a.casaId);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('POST /casa/membros', () => {
  it('matriz de papéis: 401, 403, 403; ADMIN de outra Casa adiciona à Casa dele; ADMIN 201', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    const outra = await montarCasa({ editores: 0, leitores: 0, assinatura: 'FAMILIA', prefixo: 'outra' });
    const alvo = await usuarioSolo('alvo');
    await testarMatrizDePapeis(
      casa,
      (t) => post('/casa/membros', t, { email: alvo.admin.usuario.email }),
      { semToken: 401, LEITOR: 403, EDITOR: 403, outraCasa: 201, ADMIN: 201 },
      outra,
    );
    await conferirInvariantes();
  });

  it('201: adiciona, papel padrão LEITOR, e-mail normalizado, uso e limite, auditoria e e-mail de aviso', async () => {
    const casa = await montarCasa({ editores: 0, leitores: 0, assinatura: 'FAMILIA' });
    const alvo = await usuarioSolo('alvo');
    const email = alvo.admin.usuario.email;
    const res = await post('/casa/membros', casa.admin.token, { email: `  ${email.toUpperCase()} ` });
    expect(res.status).toBe(201);
    expect(res.body.membro).toMatchObject({ usuarioId: alvo.admin.usuario.id, email, papel: 'LEITOR' });
    expect(res.body).toMatchObject({ membrosEmUso: 2, limiteMembros: 6 });
    const m = await prisma.membro.findUniqueOrThrow({ where: { usuarioId: alvo.admin.usuario.id } });
    expect(m).toMatchObject({ casaId: casa.casaId, papel: 'LEITOR' });
    const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'MEMBRO_ADICIONADO' } });
    expect(log).toMatchObject({ usuarioId: casa.admin.usuario.id, casaId: casa.casaId, entidadeId: alvo.admin.usuario.id });
    expect(log.detalhes).toMatchObject({ papel: 'LEITOR', casaAnteriorId: alvo.casaId });
    expect(caixaDeSaida.filter((e) => e.para === email)).toHaveLength(1);
  });

  it('aceita papel EDITOR; ADMIN e valores inválidos são 422; e-mail inválido é 422', async () => {
    const casa = await montarCasa({ editores: 0, leitores: 0, assinatura: 'FAMILIA' });
    const alvo = await usuarioSolo('alvo');
    const email = alvo.admin.usuario.email;
    for (const papel of ['ADMIN', 'DONO', 1]) {
      const r = await post('/casa/membros', casa.admin.token, { email, papel });
      expect(r.status).toBe(422);
      expect(r.body.error).toBe('DADOS_INVALIDOS');
    }
    expect((await post('/casa/membros', casa.admin.token, { email: 'sem-arroba' })).status).toBe(422);
    expect((await post('/casa/membros', casa.admin.token, {})).status).toBe(422);
    const ok = await post('/casa/membros', casa.admin.token, { email, papel: 'EDITOR' });
    expect(ok.status).toBe(201);
    expect(ok.body.membro.papel).toBe('EDITOR');
  });

  it('404 USUARIO_NAO_ENCONTRADO: e-mail sem conta e conta com exclusão solicitada têm a mesma resposta', async () => {
    const casa = await montarCasa({ editores: 0, leitores: 0, assinatura: 'FAMILIA' });
    const alvo = await usuarioSolo('alvo');
    await prisma.usuario.update({ where: { id: alvo.admin.usuario.id }, data: { exclusaoSolicitadaEm: new Date() } });
    const inexistente = await post('/casa/membros', casa.admin.token, { email: 'ninguem@keepit.test' });
    const excluida = await post('/casa/membros', casa.admin.token, { email: alvo.admin.usuario.email });
    expect(inexistente.status).toBe(404);
    expect(excluida.status).toBe(404);
    expect(inexistente.body).toEqual(excluida.body);
    expect(inexistente.body.error).toBe('USUARIO_NAO_ENCONTRADO');
    expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(1);
  });

  it('409 MEMBRO_JA_NA_CASA: membro atual e o próprio ADMIN', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    const a = await post('/casa/membros', casa.admin.token, { email: casa.leitor!.usuario.email });
    expect(a.status).toBe(409);
    expect(a.body.error).toBe('MEMBRO_JA_NA_CASA');
    const b = await post('/casa/membros', casa.admin.token, { email: casa.admin.usuario.email });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('MEMBRO_JA_NA_CASA');
  });

  it('409 LIMITE_MEMBROS: Individual (1) e Família no limite (6), com details; liberar uma vaga destrava', async () => {
    const individual = await montarCasa({ editores: 0, leitores: 0 });
    const alvo1 = await usuarioSolo('a1');
    const r1 = await post('/casa/membros', individual.admin.token, { email: alvo1.admin.usuario.email });
    expect(r1.status).toBe(409);
    expect(r1.body.error).toBe('LIMITE_MEMBROS');
    expect(r1.body.details).toEqual({ plano: 'INDIVIDUAL', limiteMembros: 1, membrosEmUso: 1 });

    const familia = await montarCasa({ editores: 3, leitores: 2, assinatura: 'FAMILIA' }); // 6 membros
    const alvo2 = await usuarioSolo('a2');
    const r2 = await post('/casa/membros', familia.admin.token, { email: alvo2.admin.usuario.email });
    expect(r2.status).toBe(409);
    expect(r2.body.details).toEqual({ plano: 'FAMILIA', limiteMembros: 6, membrosEmUso: 6 });
    expect(await prisma.membro.count({ where: { casaId: familia.casaId } })).toBe(6);
    // A pessoa não foi movida nem a Casa dela removida.
    expect(await prisma.casa.count({ where: { id: alvo2.casaId } })).toBe(1);

    expect((await del(`/casa/membros/${familia.leitor!.usuario.id}`, familia.admin.token)).status).toBe(204);
    expect((await post('/casa/membros', familia.admin.token, { email: alvo2.admin.usuario.email })).status).toBe(201);
  });

  it('sem oráculo de e-mails: ADMIN de Casa cheia recebe LIMITE_MEMBROS para conta existente e inexistente', async () => {
    const individual = await montarCasa({ editores: 0, leitores: 0 });
    const alvo = await usuarioSolo('existe');
    const comConta = await post('/casa/membros', individual.admin.token, { email: alvo.admin.usuario.email });
    const semConta = await post('/casa/membros', individual.admin.token, { email: 'ninguem@keepit.test' });
    const jaMembro = await post('/casa/membros', individual.admin.token, { email: individual.admin.usuario.email });
    for (const r of [comConta, semConta, jaMembro]) {
      expect(r.status).toBe(409);
      expect(r.body.error).toBe('LIMITE_MEMBROS');
    }
    expect(comConta.body).toEqual(semConta.body);
  });

  it('tentativa negada é auditada sem o e-mail em claro; sucesso não gera MEMBRO_ADICAO_NEGADA', async () => {
    const casa = await montarCasa({ editores: 0, leitores: 0, assinatura: 'FAMILIA' });
    const alvo = await usuarioSolo('alvo');
    const email = 'fantasma-secreto@keepit.test';
    expect((await post('/casa/membros', casa.admin.token, { email })).status).toBe(404);
    expect((await post('/casa/membros', casa.admin.token, { email: casa.admin.usuario.email })).status).toBe(409);
    expect((await post('/casa/membros', casa.admin.token, { email: alvo.admin.usuario.email })).status).toBe(201);
    const logs = await prisma.logAuditoria.findMany({ where: { acao: 'MEMBRO_ADICAO_NEGADA' }, orderBy: { id: 'asc' } });
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => (l.detalhes as { codigo: string }).codigo)).toEqual(['USUARIO_NAO_ENCONTRADO', 'MEMBRO_JA_NA_CASA']);
    expect(logs[0]).toMatchObject({ usuarioId: casa.admin.usuario.id, casaId: casa.casaId });
    const texto = JSON.stringify(logs, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(texto).not.toContain('fantasma-secreto');
    expect(texto).not.toContain(casa.admin.usuario.email);
    expect((logs[0]!.detalhes as { emailHmac: string }).emailHmac).toMatch(/^[0-9a-f]{16}$/);
  });

  it('429: os 201 também contam na janela (10 tentativas por 15 min, certas ou erradas)', async () => {
    process.env.TESTAR_RATE_LIMIT = '1';
    // Os limitadores guardam contagem em memória por id de usuário, e o TRUNCATE reinicia os ids: usa ids novos.
    await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('usuario', 'id'), 5000)`);
    const casa = await montarCasa({ editores: 0, leitores: 0, assinatura: 'BUSINESS' });
    for (let i = 0; i < 10; i++) {
      const alvo = await usuarioSolo(`lote${i}`);
      expect((await post('/casa/membros', casa.admin.token, { email: alvo.admin.usuario.email })).status).toBe(201);
    }
    const extra = await usuarioSolo('extra');
    const bloqueado = await post('/casa/membros', casa.admin.token, { email: extra.admin.usuario.email });
    expect(bloqueado.status).toBe(429);
    expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(11);
  });

  it('CANCELADA já vencida conta como Individual: sem vaga mesmo antes de o job rodar', async () => {
    const casa = await montarCasa({
      editores: 0,
      leitores: 0,
      assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: new Date(Date.now() - 86_400_000) },
    });
    const alvo = await usuarioSolo('alvo');
    const r = await post('/casa/membros', casa.admin.token, { email: alvo.admin.usuario.email });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('LIMITE_MEMBROS');
  });

  describe('transferência entre Casas (RF26)', () => {
    it('EDITOR de outra Casa é transferido: sai de lá, a Casa de origem continua, produtos ficam sem autor', async () => {
      const destino = await montarCasa({ editores: 0, leitores: 0, assinatura: 'FAMILIA' });
      const origem = await montarCasa({ editores: 1, leitores: 1, assinatura: 'FAMILIA', prefixo: 'orig' });
      const quem = origem.editor!;
      const produto = await criarProduto(origem.casaId, quem.usuario.id);
      const res = await post('/casa/membros', destino.admin.token, { email: quem.usuario.email, papel: 'LEITOR' });
      expect(res.status).toBe(201);
      expect(await prisma.membro.findUniqueOrThrow({ where: { usuarioId: quem.usuario.id } })).toMatchObject({ casaId: destino.casaId, papel: 'LEITOR' });
      expect(await prisma.membro.count({ where: { casaId: origem.casaId } })).toBe(2);
      expect(await prisma.casa.count({ where: { id: origem.casaId } })).toBe(1);
      expect((await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })).adicionadoPorId).toBeNull();
      // O mesmo token vale e já enxerga a Casa nova (papel e Casa são lidos do banco a cada requisição).
      const me = await get('/me', quem.token);
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ papel: 'LEITOR', casa: { id: destino.casaId }, plano: { nome: 'FAMILIA' } });
      await conferirInvariantes();
    });

    it('ADMIN solo, sem assinatura e sem produtos: é transferido e a Casa vazia dele é removida (CASA_REMOVIDA)', async () => {
      const destino = await montarCasa({ editores: 0, leitores: 0, assinatura: 'FAMILIA' });
      const alvo = await usuarioSolo('alvo');
      const res = await post('/casa/membros', destino.admin.token, { email: alvo.admin.usuario.email, papel: 'EDITOR' });
      expect(res.status).toBe(201);
      expect(await prisma.casa.count({ where: { id: alvo.casaId } })).toBe(0);
      expect(await prisma.logAuditoria.count({ where: { acao: 'CASA_REMOVIDA', entidadeId: alvo.casaId } })).toBe(1);
      expect((await get('/me', alvo.admin.token)).body).toMatchObject({ papel: 'EDITOR', casa: { id: destino.casaId } });
      await conferirInvariantes();
    });

    it('409 MEMBRO_NAO_TRANSFERIVEL (sem motivo): ADMIN de Casa com membros, titular vigente e ADMIN solo com produtos', async () => {
      const destino = await montarCasa({ editores: 0, leitores: 0, assinatura: 'BUSINESS' });
      const comMembros = await montarCasa({ editores: 1, leitores: 0, prefixo: 'cm' });
      const titular = await montarCasa({ editores: 0, leitores: 0, assinatura: 'FAMILIA', prefixo: 'tit' });
      const cancelada = await montarCasa({ editores: 0, leitores: 0, assinatura: { plano: 'FAMILIA', status: 'CANCELADA' }, prefixo: 'can' });
      const comProdutos = await usuarioSolo('prod');
      await criarProduto(comProdutos.casaId, comProdutos.admin.usuario.id);
      for (const alvo of [comMembros, titular, cancelada, comProdutos]) {
        const r = await post('/casa/membros', destino.admin.token, { email: alvo.admin.usuario.email });
        expect(r.status).toBe(409);
        expect(r.body.error).toBe('MEMBRO_NAO_TRANSFERIVEL');
        expect(r.body.details).toBeUndefined();
        expect(await prisma.membro.findUniqueOrThrow({ where: { usuarioId: alvo.admin.usuario.id } })).toMatchObject({ casaId: alvo.casaId, papel: 'ADMIN' });
        expect(await prisma.casa.count({ where: { id: alvo.casaId } })).toBe(1);
      }
      expect(await prisma.produto.count({ where: { casaId: comProdutos.casaId } })).toBe(1);
      expect(await prisma.membro.count({ where: { casaId: destino.casaId } })).toBe(1);
    });

    it('ADMIN solo com assinatura EXPIRADA antiga (sem produtos) é transferível', async () => {
      const destino = await montarCasa({ editores: 0, leitores: 0, assinatura: 'FAMILIA' });
      const alvo = await usuarioSolo('alvo');
      await criarAssinaturaDeTeste(alvo.casaId, alvo.admin.usuario.id, 'FAMILIA', { status: 'EXPIRADA' });
      expect((await post('/casa/membros', destino.admin.token, { email: alvo.admin.usuario.email })).status).toBe(201);
      expect(await prisma.assinatura.count({ where: { casaId: alvo.casaId } })).toBe(0); // saiu junto com a Casa vazia
    });
  });

  it('duas adições simultâneas não passam do limite do plano (Casa travada)', async () => {
    const casa = await montarCasa({ editores: 3, leitores: 1, assinatura: 'FAMILIA' }); // 5 de 6
    const [a, b] = [await usuarioSolo('a'), await usuarioSolo('b')];
    const rs = await Promise.all(
      [a, b].map((x) => post('/casa/membros', casa.admin.token, { email: x.admin.usuario.email })),
    );
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(6);
    await conferirInvariantes();
  });

  it('dois ADMINs se adicionando ao mesmo tempo não travam (ordem de travas por id) e nenhum fica sem Casa', async () => {
    const a = await montarCasa({ editores: 0, leitores: 0, assinatura: 'FAMILIA', prefixo: 'a' });
    const b = await montarCasa({ editores: 0, leitores: 0, assinatura: 'FAMILIA', prefixo: 'b' });
    const rs = await Promise.all([
      post('/casa/membros', a.admin.token, { email: b.admin.usuario.email }),
      post('/casa/membros', b.admin.token, { email: a.admin.usuario.email }),
    ]);
    for (const r of rs) expect([201, 404, 409]).toContain(r.status);
    expect(await prisma.membro.count()).toBe(2);
    await conferirInvariantes();
  });

  it('429 MUITAS_TENTATIVAS após 5 erros (404/409) em 15 min; o 422 não consome o limite', async () => {
    process.env.TESTAR_RATE_LIMIT = '1';
    const casa = await montarCasa({ editores: 0, leitores: 0, assinatura: 'FAMILIA' });
    for (let i = 0; i < 10; i++) expect((await post('/casa/membros', casa.admin.token, { email: 'invalido' })).status).toBe(422);
    for (let i = 0; i < 5; i++) {
      expect((await post('/casa/membros', casa.admin.token, { email: `nao${i}@keepit.test` })).status).toBe(404);
    }
    const bloqueado = await post('/casa/membros', casa.admin.token, { email: 'nao9@keepit.test' });
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.error).toBe('MUITAS_TENTATIVAS');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('PATCH /casa/membros/:usuarioId', () => {
  it('matriz de papéis: 401, 403, 403; ADMIN de outra Casa 404 (o membro não está na Casa dele); ADMIN 200', async () => {
    const casa = await montarCasa();
    await testarMatrizDePapeis(
      casa,
      (t) => patch(`/casa/membros/${casa.leitor!.usuario.id}`, t, { papel: 'EDITOR' }),
      { semToken: 401, LEITOR: 403, EDITOR: 403, outraCasa: 404, ADMIN: 200 },
    );
  });

  it('200: LEITOR vira EDITOR e volta; vale na requisição seguinte do membro com o mesmo token; audita', async () => {
    const casa = await montarCasa();
    const { usuario, token } = casa.leitor!;
    expect((await get('/me', token)).body.papel).toBe('LEITOR');
    const r = await patch(`/casa/membros/${usuario.id}`, casa.admin.token, { papel: 'EDITOR' });
    expect(r.status).toBe(200);
    expect(r.body.membro).toMatchObject({ usuarioId: usuario.id, papel: 'EDITOR', email: usuario.email });
    expect((await get('/me', token)).body.papel).toBe('EDITOR');
    const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'MEMBRO_PAPEL_ALTERADO' } });
    expect(log).toMatchObject({ usuarioId: casa.admin.usuario.id, casaId: casa.casaId, entidadeId: usuario.id });
    expect(log.detalhes).toEqual({ de: 'LEITOR', para: 'EDITOR' });
    expect((await patch(`/casa/membros/${usuario.id}`, casa.admin.token, { papel: 'LEITOR' })).status).toBe(200);
    expect((await get('/me', token)).body.papel).toBe('LEITOR');
  });

  it('papel igual ao atual: 200 sem alteração e sem log', async () => {
    const casa = await montarCasa();
    const r = await patch(`/casa/membros/${casa.editor!.usuario.id}`, casa.admin.token, { papel: 'EDITOR' });
    expect(r.status).toBe(200);
    expect(r.body.membro.papel).toBe('EDITOR');
    expect(await prisma.logAuditoria.count({ where: { acao: 'MEMBRO_PAPEL_ALTERADO' } })).toBe(0);
  });

  it('409 ESTADO_INVALIDO no próprio ADMIN; 404 em membro de outra Casa e inexistente; 422 em papel e id inválidos', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ prefixo: 'outra' });
    const adm = await patch(`/casa/membros/${casa.admin.usuario.id}`, casa.admin.token, { papel: 'LEITOR' });
    expect(adm.status).toBe(409);
    expect(adm.body.error).toBe('ESTADO_INVALIDO');
    expect((await prisma.membro.findUniqueOrThrow({ where: { usuarioId: casa.admin.usuario.id } })).papel).toBe('ADMIN');
    const alheio = await patch(`/casa/membros/${outra.leitor!.usuario.id}`, casa.admin.token, { papel: 'EDITOR' });
    expect(alheio.status).toBe(404);
    expect(alheio.body.error).toBe('NAO_ENCONTRADO');
    expect((await prisma.membro.findUniqueOrThrow({ where: { usuarioId: outra.leitor!.usuario.id } })).papel).toBe('LEITOR');
    expect((await patch('/casa/membros/99999', casa.admin.token, { papel: 'EDITOR' })).status).toBe(404);
    const id = casa.leitor!.usuario.id;
    for (const papel of ['ADMIN', 'DONO', undefined]) {
      expect((await patch(`/casa/membros/${id}`, casa.admin.token, { papel })).status).toBe(422);
    }
    for (const lixo of ['abc', '1.5', '-3', '0']) {
      expect((await patch(`/casa/membros/${lixo}`, casa.admin.token, { papel: 'EDITOR' })).status).toBe(422);
    }
    await conferirInvariantes();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('DELETE /casa/membros/:usuarioId', () => {
  it('matriz de papéis: 401, 403, 403; ADMIN de outra Casa 404; ADMIN 204', async () => {
    const casa = await montarCasa();
    await testarMatrizDePapeis(
      casa,
      (t) => del(`/casa/membros/${casa.leitor!.usuario.id}`, t),
      { semToken: 401, LEITOR: 403, EDITOR: 403, outraCasa: 404, ADMIN: 204 },
    );
  });

  it('204: o removido ganha Casa Individual própria como ADMIN; produtos ficam na Casa sem autor; vaga liberada; assinatura intacta', async () => {
    const casa = await montarCasa({ editores: 1, leitores: 0, assinatura: 'FAMILIA' });
    const { usuario, token } = casa.editor!;
    const produto = await criarProduto(casa.casaId, usuario.id);
    const res = await del(`/casa/membros/${usuario.id}`, casa.admin.token);
    expect(res.status).toBe(204);
    const m = await prisma.membro.findUniqueOrThrow({ where: { usuarioId: usuario.id }, include: { casa: true } });
    expect(m.papel).toBe('ADMIN');
    expect(m.casaId).not.toBe(casa.casaId);
    expect(m.casa.nome).toMatch(/^Casa de /);
    expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(1);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })).adicionadoPorId).toBeNull();
    expect(await prisma.assinatura.count({ where: { casaId: casa.casaId, status: 'ATIVA' } })).toBe(1);
    // O removido, com o mesmo token, já está na Casa nova, Individual.
    const me = await get('/me', token);
    expect(me.body).toMatchObject({ papel: 'ADMIN', casa: { id: m.casaId, totalMembros: 1 }, plano: { nome: 'INDIVIDUAL' }, assinatura: null });
    const acoes = await prisma.logAuditoria.findMany({ where: { acao: { in: ['MEMBRO_REMOVIDO', 'CASA_CRIADA'] } } });
    expect(acoes.map((l) => l.acao).sort()).toEqual(['CASA_CRIADA', 'MEMBRO_REMOVIDO']);
    expect(caixaDeSaida.filter((e) => e.para === usuario.email)).toHaveLength(1);
    await conferirInvariantes();
  });

  it('409 ESTADO_INVALIDO no próprio ADMIN; 404 em membro de outra Casa e inexistente; 422 em id inválido', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ prefixo: 'outra' });
    const adm = await del(`/casa/membros/${casa.admin.usuario.id}`, casa.admin.token);
    expect(adm.status).toBe(409);
    expect(adm.body.error).toBe('ESTADO_INVALIDO');
    expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(3);
    const alheio = await del(`/casa/membros/${outra.editor!.usuario.id}`, casa.admin.token);
    expect(alheio.status).toBe(404);
    expect(await prisma.membro.count({ where: { casaId: outra.casaId } })).toBe(3);
    expect((await del('/casa/membros/99999', casa.admin.token)).status).toBe(404);
    expect((await del('/casa/membros/abc', casa.admin.token)).status).toBe(422);
  });

  it('id acima do int4 do Postgres: 422 DADOS_INVALIDOS (e não 500) em DELETE e PATCH', async () => {
    const casa = await montarCasa();
    for (const id of ['99999999999', '2147483648']) {
      const d = await del(`/casa/membros/${id}`, casa.admin.token);
      expect(d.status).toBe(422);
      expect(d.body.error).toBe('DADOS_INVALIDOS');
      expect((await patch(`/casa/membros/${id}`, casa.admin.token, { papel: 'EDITOR' })).status).toBe(422);
    }
    expect((await del('/casa/membros/2147483647', casa.admin.token)).status).toBe(404);
  });

  it('remover duas vezes: a segunda dá 404 (ele já não está na Casa)', async () => {
    const casa = await montarCasa();
    const id = casa.leitor!.usuario.id;
    expect((await del(`/casa/membros/${id}`, casa.admin.token)).status).toBe(204);
    expect((await del(`/casa/membros/${id}`, casa.admin.token)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('PATCH /casa', () => {
  it('matriz de papéis: 401, 403, 403; ADMIN de outra Casa renomeia a dele; ADMIN 200', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ prefixo: 'outra' });
    await testarMatrizDePapeis(casa, (t, quem) => patch('/casa', t, { nome: `Casa ${quem}` }), {
      semToken: 401, LEITOR: 403, EDITOR: 403, outraCasa: 200, ADMIN: 200,
    }, outra);
    expect((await prisma.casa.findUniqueOrThrow({ where: { id: casa.casaId } })).nome).toBe('Casa ADMIN');
    expect((await prisma.casa.findUniqueOrThrow({ where: { id: outra.casaId } })).nome).toBe('Casa outraCasa');
  });

  it('200: renomeia (trim), audita de/para e todos veem o novo nome em GET /me', async () => {
    const casa = await montarCasa();
    const antes = (await prisma.casa.findUniqueOrThrow({ where: { id: casa.casaId } })).nome;
    const r = await patch('/casa', casa.admin.token, { nome: '  Família Souza ' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ casa: { id: casa.casaId, nome: 'Família Souza' } });
    expect((await get('/me', casa.leitor!.token)).body.casa.nome).toBe('Família Souza');
    const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'CASA_RENOMEADA' } });
    expect(log.detalhes).toEqual({ de: antes, para: 'Família Souza' });
  });

  it('mesmo nome: 200 sem log', async () => {
    const casa = await montarCasa();
    await patch('/casa', casa.admin.token, { nome: 'Igual' });
    await patch('/casa', casa.admin.token, { nome: 'Igual' });
    expect(await prisma.logAuditoria.count({ where: { acao: 'CASA_RENOMEADA' } })).toBe(1);
  });

  it('422 com details por campo: vazio, só espaços, longo, < > e caracteres de controle; sem corpo', async () => {
    const casa = await montarCasa();
    for (const nome of ['', '   ', 'a'.repeat(81), 'Casa <b>', 'Casa\nnova', 'Casa\u202Eevil', 'Ca\u200Bsa', undefined, 7]) {
      const r = await patch('/casa', casa.admin.token, { nome });
      expect(r.status, JSON.stringify(nome)).toBe(422);
      expect(r.body.error).toBe('DADOS_INVALIDOS');
      expect(r.body.details[0].campo).toBe('nome');
    }
    expect((await patch('/casa', casa.admin.token)).status).toBe(422);
    expect((await patch('/casa', casa.admin.token, { nome: 'a'.repeat(80) })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('POST /casa/sair (saída voluntária de EDITOR e LEITOR)', () => {
  it('matriz de papéis: 401 sem token; ADMIN 403 (de qualquer Casa); EDITOR e LEITOR 200', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ prefixo: 'outra' });
    expect((await post('/casa/sair', undefined)).status).toBe(401);
    expect((await post('/casa/sair', casa.admin.token)).status).toBe(403);
    expect((await post('/casa/sair', outra.admin.token)).status).toBe(403);
    expect((await post('/casa/sair', casa.editor!.token)).status).toBe(200);
    expect((await post('/casa/sair', casa.leitor!.token)).status).toBe(200);
  });

  it('o membro ganha Casa Individual própria como ADMIN, produtos ficam sem autor, vaga liberada, auditado', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    const produto = await criarProduto(casa.casaId, casa.editor!.usuario.id);
    const r = await post('/casa/sair', casa.editor!.token);
    expect(r.status).toBe(200);
    expect(r.body.perfil).toMatchObject({ papel: 'ADMIN', plano: { nome: 'INDIVIDUAL' }, assinatura: null, casa: { totalMembros: 1 } });
    expect(r.body.perfil.casa.id).not.toBe(casa.casaId);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })).adicionadoPorId).toBeNull();
    expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(2);
    expect(await prisma.logAuditoria.count({ where: { acao: 'MEMBRO_SAIU_DA_CASA', usuarioId: casa.editor!.usuario.id } })).toBe(1);
    // Agora ele é ADMIN solo e não pode sair de novo.
    expect((await post('/casa/sair', casa.editor!.token)).status).toBe(403);
    await conferirInvariantes();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('exclusão de conta: herdeiro sem exclusão pendente', () => {
  const excluirNaTransacao = (usuarioId: number) => prisma.$transaction((tx) => tratarExclusaoDeConta(tx, usuarioId));

  it('o herdeiro pula quem já pediu a própria exclusão', async () => {
    const casa = await montarCasa({ editores: 1, leitores: 1 });
    const [admin, editor, leitor] = casa.membros;
    await prisma.usuario.update({ where: { id: editor!.usuario.id }, data: { exclusaoSolicitadaEm: new Date() } });
    await excluirNaTransacao(admin!.usuario.id);
    expect(await prisma.membro.findUniqueOrThrow({ where: { usuarioId: leitor!.usuario.id } })).toMatchObject({ casaId: casa.casaId, papel: 'ADMIN' });
    await conferirInvariantes();
  });

  it('sem herdeiro elegível: tratado como ADMIN solo (nada é promovido nem movido)', async () => {
    const casa = await montarCasa({ editores: 1, leitores: 0, assinatura: 'FAMILIA' });
    const [admin, editor] = casa.membros;
    await prisma.usuario.update({ where: { id: editor!.usuario.id }, data: { exclusaoSolicitadaEm: new Date() } });
    const avisos = await excluirNaTransacao(admin!.usuario.id);
    expect(avisos).toEqual([]);
    expect(await prisma.membro.findUniqueOrThrow({ where: { usuarioId: editor!.usuario.id } })).toMatchObject({ casaId: casa.casaId, papel: 'EDITOR' });
    expect((await prisma.membro.findUniqueOrThrow({ where: { usuarioId: admin!.usuario.id } })).papel).toBe('ADMIN');
    expect((await prisma.assinatura.findFirstOrThrow({ where: { casaId: casa.casaId } })).status).toBe('EXPIRADA');
    await conferirInvariantes();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('exclusão de conta (DELETE /me): ganchos de M2 e M5 (ACH-08)', () => {
  /** Dá uma senha conhecida ao usuário (os helpers de teste gravam um hash de mentira). */
  async function comSenha(...ids: number[]) {
    const senhaHash = await hashSenha(SENHA);
    await prisma.usuario.updateMany({ where: { id: { in: ids } }, data: { senhaHash } });
  }
  const excluir = (token: string) => del('/me', token, { senha: SENHA });
  const vencer = (...ids: number[]) =>
    prisma.usuario.updateMany({
      where: { id: { in: ids } },
      data: { exclusaoSolicitadaEm: new Date(Date.now() - 25 * 3_600_000) },
    });
  const papelDe = async (c: CasaDeTeste, i: number) =>
    (await prisma.membro.findUniqueOrThrow({ where: { usuarioId: c.membros[i]!.usuario.id } })).papel;

  it('LEITOR/EDITOR: o vínculo sai na hora, a vaga é liberada, produtos ficam sem autor; Casa e assinatura não mudam', async () => {
    const casa = await montarCasa({ editores: 1, leitores: 1, assinatura: 'FAMILIA' });
    const editor = casa.editor!;
    await comSenha(editor.usuario.id);
    const produto = await criarProduto(casa.casaId, editor.usuario.id);
    expect((await excluir(editor.token)).status).toBe(204);
    expect(await prisma.membro.findUnique({ where: { usuarioId: editor.usuario.id } })).toBeNull();
    expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(2);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })).adicionadoPorId).toBeNull();
    expect(await prisma.assinatura.count({ where: { casaId: casa.casaId, status: 'ATIVA' } })).toBe(1);
    expect(await prisma.logAuditoria.count({ where: { acao: 'MEMBRO_REMOVIDO', entidadeId: editor.usuario.id } })).toBe(1);
    // A rotina depois só apaga o usuário (já sem vínculo), sem mexer na Casa.
    await vencer(editor.usuario.id);
    expect(await apagarContasVencidas()).toBe(1);
    expect(await prisma.casa.count({ where: { id: casa.casaId } })).toBe(1);
    await conferirInvariantes();
  });

  it('ADMIN solo titular: a assinatura expira (TITULAR_EXCLUIDO) e a rotina apaga conta e Casa sem falhar', async () => {
    const casa = await montarCasa({ editores: 0, leitores: 0, assinatura: 'FAMILIA' });
    await comSenha(casa.admin.usuario.id);
    expect((await excluir(casa.admin.token)).status).toBe(204);
    const a = await prisma.assinatura.findFirstOrThrow({ where: { casaId: casa.casaId } });
    expect(a).toMatchObject({ status: 'EXPIRADA', motivoEncerramento: 'TITULAR_EXCLUIDO' });
    expect(a.encerradaEm).not.toBeNull();
    expect(await prisma.logAuditoria.count({ where: { acao: 'ASSINATURA_EXPIRADA', entidadeId: a.id } })).toBe(1);
    await vencer(casa.admin.usuario.id);
    expect(await apagarContasVencidas()).toBe(1);
    expect(await prisma.usuario.count()).toBe(0);
    expect(await prisma.casa.count()).toBe(0);
    expect(await prisma.assinatura.count()).toBe(0);
  });

  it('ADMIN com membros: o EDITOR herda (mesmo havendo LEITOR mais antigo), Casa e produtos ficam, os demais ganham Casa própria', async () => {
    const casa = await montarCasa({ editores: 1, leitores: 2, assinatura: 'FAMILIA' });
    const [admin, editor, l1, l2] = casa.membros;
    await comSenha(admin!.usuario.id);
    const produto = await criarProduto(casa.casaId, admin!.usuario.id);
    // O LEITOR l1 é o mais antigo de todos; mesmo assim o EDITOR é o herdeiro.
    await prisma.membro.update({ where: { usuarioId: l1!.usuario.id }, data: { entrouEm: new Date(Date.now() - 5 * 86_400_000) } });
    expect((await excluir(admin!.token)).status).toBe(204);

    expect(await prisma.membro.findUnique({ where: { usuarioId: admin!.usuario.id } })).toBeNull();
    const herdeiro = await prisma.membro.findUniqueOrThrow({ where: { usuarioId: editor!.usuario.id } });
    expect(herdeiro).toMatchObject({ casaId: casa.casaId, papel: 'ADMIN' });
    expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(1);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })).adicionadoPorId).toBeNull();
    for (const l of [l1!, l2!]) {
      const m = await prisma.membro.findUniqueOrThrow({ where: { usuarioId: l.usuario.id } });
      expect(m.papel).toBe('ADMIN');
      expect(m.casaId).not.toBe(casa.casaId);
    }
    expect(await prisma.assinatura.findFirstOrThrow({ where: { casaId: casa.casaId } })).toMatchObject({ status: 'EXPIRADA', motivoEncerramento: 'TITULAR_EXCLUIDO' });

    // Perfis (mesmos tokens): herdeiro é ADMIN da Casa antiga no Individual; os demais, de uma Casa nova.
    expect((await get('/me', editor!.token)).body).toMatchObject({ papel: 'ADMIN', casa: { id: casa.casaId, totalMembros: 1 }, plano: { nome: 'INDIVIDUAL' }, assinatura: null });
    expect((await get('/me', l2!.token)).body).toMatchObject({ papel: 'ADMIN', casa: { totalMembros: 1 }, plano: { nome: 'INDIVIDUAL' } });
    const acoes = (await prisma.logAuditoria.findMany()).map((l) => l.acao);
    expect(acoes).toContain('MEMBRO_PROMOVIDO_ADMIN');
    expect(acoes.filter((a) => a === 'CASA_CRIADA')).toHaveLength(2);
    expect(caixaDeSaida.map((e) => e.para).sort()).toEqual([editor!, l1!, l2!].map((m) => m.usuario.email).sort());

    // A rotina apaga a conta do ex-ADMIN sem falhar (titularId vira nulo) e a Casa continua com o herdeiro.
    await vencer(admin!.usuario.id);
    expect(await apagarContasVencidas()).toBe(1);
    expect(await prisma.casa.count({ where: { id: casa.casaId } })).toBe(1);
    expect((await prisma.assinatura.findFirstOrThrow({ where: { casaId: casa.casaId } })).titularId).toBeNull();
    await conferirInvariantes();
  });

  it('ADMIN com membros e sem EDITOR: o LEITOR mais antigo herda; sem assinatura também funciona', async () => {
    const casa = await montarCasa({ editores: 0, leitores: 2 });
    const [admin, l1, l2] = casa.membros;
    await comSenha(admin!.usuario.id);
    await prisma.membro.update({ where: { usuarioId: l2!.usuario.id }, data: { entrouEm: new Date(Date.now() - 86_400_000) } });
    expect((await excluir(admin!.token)).status).toBe(204);
    expect(await prisma.membro.findUniqueOrThrow({ where: { usuarioId: l2!.usuario.id } })).toMatchObject({ casaId: casa.casaId, papel: 'ADMIN' });
    expect((await prisma.membro.findUniqueOrThrow({ where: { usuarioId: l1!.usuario.id } })).casaId).not.toBe(casa.casaId);
    await conferirInvariantes();
  });

  it('senha incorreta não mexe em nada (Casa, papéis e assinatura intactos)', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    await comSenha(casa.admin.usuario.id);
    const r = await del('/me', casa.admin.token, { senha: 'errada-errada' });
    expect(r.status).toBe(401);
    expect(await papelDe(casa, 0)).toBe('ADMIN');
    expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(3);
    expect(await prisma.assinatura.count({ where: { casaId: casa.casaId, status: 'ATIVA' } })).toBe(1);
  });
});
