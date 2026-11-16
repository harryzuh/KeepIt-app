import { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../../app.js';
import { env, envSchema } from '../../config/env.js';
import { descreverErro } from '../../lib/erro-log.js';
import { assinarToken } from '../../lib/jwt.js';
import { caixaDeSaida } from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';
import { limites } from '../../middlewares/limitar.js';
import { limparBanco } from '../../test/db.js';
import { alertarExclusoesAtrasadas, MAX_TENTATIVAS_CODIGO } from './auth.service.js';

/** Correções de segurança do M1 (AppSec F2, F3, F11, F14, F15, F19 e achados ACH-01 a ACH-10). */

const SENHA = 'senha-forte-1';
const comToken = (token: string) => ({ Authorization: `Bearer ${token}` });

async function cadastrar(nome = 'Ana Souza', email = 'ana@keepit.test') {
  return request(app).post('/auth/cadastro').send({ nome, email, senha: SENHA, confirmarSenha: SENHA });
}
const login = (email = 'ana@keepit.test', senha = SENHA) => request(app).post('/auth/login').send({ email, senha });

function ultimoCodigo(para: string): string {
  const email = [...caixaDeSaida].reverse().find((e) => e.para === para && /\b\d{6}\b/.test(e.texto));
  const codigo = email?.texto.match(/\b\d{6}\b/)?.[0];
  if (!codigo) throw new Error(`Nenhum e-mail com código para ${para}`);
  return codigo;
}
const errado = (certo: string) => (certo === '000000' ? '111111' : '000000');

beforeEach(async () => {
  await limparBanco();
  caixaDeSaida.length = 0;
});
afterAll(() => prisma.$disconnect());

describe('defeitos 1 e 7: troca de e-mail exige senha e avisa o e-mail antigo', () => {
  let token: string;
  beforeEach(async () => {
    token = (await cadastrar()).body.token;
  });
  const pedir = (corpo: object, t = token) => request(app).post('/me/email').set(comToken(t)).send(corpo);

  it('422 sem senhaAtual: nada é enviado', async () => {
    const res = await pedir({ email: 'novo@keepit.test' });
    expect(res.status).toBe(422);
    expect(res.body.details[0].campo).toBe('senhaAtual');
    expect(caixaDeSaida).toHaveLength(0);
  });

  it('401 SENHA_INCORRETA com senha errada: nenhum código nem aviso, nada gravado', async () => {
    const res = await pedir({ email: 'novo@keepit.test', senhaAtual: 'senha-errada-9' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('SENHA_INCORRETA');
    expect(caixaDeSaida).toHaveLength(0);
    expect(await prisma.codigoVerificacao.count()).toBe(0);
  });

  it('avisa o e-mail ANTIGO no pedido e na confirmação (sem código e sem nome do usuário)', async () => {
    expect((await pedir({ email: 'novo@keepit.test', senhaAtual: SENHA })).status).toBe(200);
    const avisoPedido = caixaDeSaida.find((e) => e.para === 'ana@keepit.test');
    expect(avisoPedido?.assunto).toMatch(/troca de e-mail/i);
    expect(avisoPedido?.texto).toContain('no***@keepit.test');
    expect(avisoPedido?.texto).not.toMatch(/\b\d{6}\b/);

    const conf = await request(app)
      .post('/me/email/confirmar')
      .set(comToken(token))
      .send({ codigo: ultimoCodigo('novo@keepit.test') });
    expect(conf.status).toBe(200);
    const avisos = caixaDeSaida.filter((e) => e.para === 'ana@keepit.test');
    expect(avisos).toHaveLength(2);
    expect(avisos[1]?.assunto).toMatch(/foi alterado/i);
  });

  it('a confirmação encerra as sessões antigas; o token novo da resposta vale na hora', async () => {
    await pedir({ email: 'novo@keepit.test', senhaAtual: SENHA });
    const conf = await request(app)
      .post('/me/email/confirmar')
      .set(comToken(token))
      .send({ codigo: ultimoCodigo('novo@keepit.test') });
    expect((await request(app).get('/me').set(comToken(token))).status).toBe(401);
    const me = await request(app).get('/me').set(comToken(conf.body.token));
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('novo@keepit.test');
  });

  it('o e-mail de troca vai sem o nome do usuário (anti-phishing)', async () => {
    await pedir({ email: 'novo@keepit.test', senhaAtual: SENHA });
    const paraNovo = caixaDeSaida.find((e) => e.para === 'novo@keepit.test');
    expect(paraNovo?.texto).not.toContain('Ana');
    expect(paraNovo?.html).not.toContain('Ana');
  });
});

describe('defeito 3: token emitido no mesmo segundo do corte vale', () => {
  it('login logo após o logout (sem esperar) devolve token válido, 5 de 5 vezes', async () => {
    await cadastrar();
    for (let i = 0; i < 5; i++) {
      const { body } = await login();
      expect((await request(app).post('/auth/logout').set(comToken(body.token))).status).toBe(204);
      expect((await request(app).get('/me').set(comToken(body.token))).status).toBe(401);
      const novo = await login();
      expect(novo.status).toBe(200);
      expect((await request(app).get('/me').set(comToken(novo.body.token))).status).toBe(200);
    }
  });

  it('login logo após redefinir a senha vale; o token anterior não', async () => {
    const antigo = (await cadastrar()).body.token;
    await request(app).post('/auth/recuperar-senha').send({ email: 'ana@keepit.test' });
    const red = await request(app)
      .post('/auth/redefinir-senha')
      .send({ email: 'ana@keepit.test', codigo: ultimoCodigo('ana@keepit.test'), novaSenha: 'nova-senha-2', confirmarSenha: 'nova-senha-2' });
    expect(red.status).toBe(204);
    expect((await request(app).get('/me').set(comToken(antigo))).status).toBe(401);
    const novo = await login('ana@keepit.test', 'nova-senha-2');
    expect((await request(app).get('/me').set(comToken(novo.body.token))).status).toBe(200);
  });

  it('alterar senha: token novo vale na hora e o antigo cai (sem janela de 1 s)', async () => {
    const antigo = (await cadastrar()).body.token;
    const res = await request(app)
      .patch('/me/senha')
      .set(comToken(antigo))
      .send({ senhaAtual: SENHA, novaSenha: 'nova-senha-2', confirmarSenha: 'nova-senha-2' });
    expect(res.status).toBe(200);
    expect((await request(app).get('/me').set(comToken(res.body.token))).status).toBe(200);
    expect((await request(app).get('/me').set(comToken(antigo))).status).toBe(401);
  });

  it('exclusão: o token antigo e um novo login (conta bloqueada) não passam', async () => {
    const { token } = (await cadastrar()).body;
    const res = await request(app).delete('/me').set(comToken(token)).send({ senha: SENHA });
    expect(res.status).toBe(204);
    expect((await request(app).get('/me').set(comToken(token))).status).toBe(401);
    expect((await login()).status).toBe(401);
  });
});

describe('defeitos 4 e 9: limite de tentativas por código (independe de IP)', () => {
  it('redefinir senha: no 5º erro o código é invalidado, até o código correto deixa de valer', async () => {
    await cadastrar();
    await request(app).post('/auth/recuperar-senha').send({ email: 'ana@keepit.test' });
    const certo = ultimoCodigo('ana@keepit.test');
    const corpo = (codigo: string) => ({ email: 'ana@keepit.test', codigo, novaSenha: 'nova-senha-2', confirmarSenha: 'nova-senha-2' });
    for (let i = 0; i < MAX_TENTATIVAS_CODIGO; i++) {
      // "IPs" diferentes: o limite por código não depende do IP
      const res = await request(app).post('/auth/redefinir-senha').set('X-Forwarded-For', `203.0.113.${i + 1}`).send(corpo(errado(certo)));
      expect(res.status).toBe(400);
    }
    const reg = await prisma.codigoVerificacao.findFirstOrThrow({ where: { finalidade: 'RECUPERAR_SENHA' } });
    expect(reg.tentativas).toBe(MAX_TENTATIVAS_CODIGO);
    const tarde = await request(app).post('/auth/redefinir-senha').send(corpo(certo));
    expect(tarde.status).toBe(400);
    expect(tarde.body.error).toBe('CODIGO_INVALIDO');
    expect((await login('ana@keepit.test', SENHA)).status).toBe(200); // senha não mudou
  });

  it('com erros abaixo do limite, o código certo ainda funciona', async () => {
    await cadastrar();
    await request(app).post('/auth/recuperar-senha').send({ email: 'ana@keepit.test' });
    const certo = ultimoCodigo('ana@keepit.test');
    const corpo = (codigo: string) => ({ email: 'ana@keepit.test', codigo, novaSenha: 'nova-senha-2', confirmarSenha: 'nova-senha-2' });
    for (let i = 0; i < MAX_TENTATIVAS_CODIGO - 1; i++) {
      await request(app).post('/auth/redefinir-senha').send(corpo(errado(certo)));
    }
    expect((await request(app).post('/auth/redefinir-senha').send(corpo(certo))).status).toBe(204);
  });

  it('palpites simultâneos gastam no máximo MAX_TENTATIVAS_CODIGO comparações', async () => {
    await cadastrar();
    await request(app).post('/auth/recuperar-senha').send({ email: 'ana@keepit.test' });
    const certo = ultimoCodigo('ana@keepit.test');
    const corpo = (codigo: string) => ({ email: 'ana@keepit.test', codigo, novaSenha: 'nova-senha-2', confirmarSenha: 'nova-senha-2' });
    await Promise.all(
      Array.from({ length: 25 }, () => request(app).post('/auth/redefinir-senha').send(corpo(errado(certo)))),
    );
    const reg = await prisma.codigoVerificacao.findFirstOrThrow({ where: { finalidade: 'RECUPERAR_SENHA' } });
    expect(reg.tentativas).toBe(MAX_TENTATIVAS_CODIGO);
    expect((await request(app).post('/auth/redefinir-senha').send(corpo(certo))).status).toBe(400);
  });

  it('trocar e-mail: no 5º erro o código é invalidado; é preciso pedir outro', async () => {
    const token = (await cadastrar()).body.token;
    const pedir = () => request(app).post('/me/email').set(comToken(token)).send({ email: 'novo@keepit.test', senhaAtual: SENHA });
    await pedir();
    const certo = ultimoCodigo('novo@keepit.test');
    const confirmar = (codigo: string) => request(app).post('/me/email/confirmar').set(comToken(token)).send({ codigo });
    for (let i = 0; i < MAX_TENTATIVAS_CODIGO; i++) expect((await confirmar(errado(certo))).status).toBe(400);
    expect((await confirmar(certo)).status).toBe(400);
    await pedir();
    const novo = ultimoCodigo('novo@keepit.test');
    expect((await confirmar(novo)).status).toBe(200);
  });
});

describe('defeito 14.5: trocar a senha invalida códigos pendentes', () => {
  it('código de recuperação pedido antes da troca de senha não vale depois', async () => {
    const token = (await cadastrar()).body.token;
    await request(app).post('/auth/recuperar-senha').send({ email: 'ana@keepit.test' });
    const codigo = ultimoCodigo('ana@keepit.test');
    const alt = await request(app)
      .patch('/me/senha')
      .set(comToken(token))
      .send({ senhaAtual: SENHA, novaSenha: 'nova-senha-2', confirmarSenha: 'nova-senha-2' });
    expect(alt.status).toBe(200);
    const res = await request(app)
      .post('/auth/redefinir-senha')
      .send({ email: 'ana@keepit.test', codigo, novaSenha: 'outra-senha-3', confirmarSenha: 'outra-senha-3' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CODIGO_INVALIDO');
  });
});

describe('defeito 5: Cache-Control: no-store', () => {
  it('em /auth/* e /me*, inclusive em erros', async () => {
    const cad = await cadastrar();
    expect(cad.headers['cache-control']).toBe('no-store');
    expect((await login()).headers['cache-control']).toBe('no-store');
    expect((await request(app).get('/me').set(comToken(cad.body.token))).headers['cache-control']).toBe('no-store');
    expect((await request(app).get('/me')).headers['cache-control']).toBe('no-store'); // 401
    expect((await request(app).post('/auth/login').send({})).headers['cache-control']).toBe('no-store'); // 422
  });
});

describe('defeito 6: limites independentes por rota e cadastro só conta sucessos', () => {
  beforeAll(() => {
    process.env.TESTAR_RATE_LIMIT = '1';
  });
  afterAll(() => {
    delete process.env.TESTAR_RATE_LIMIT;
  });
  // ids de usuário reiniciam a cada teste (RESTART IDENTITY): zera os contadores por usuário.
  beforeEach(async () => {
    for (const l of [limites.confirmarEmail, limites.alterarSenha, limites.excluirConta, limites.pedirTrocaEmail]) {
      await l.resetKey('u:1');
    }
    // cadastro é por IP (supertest chega como loopback): zera para o teste de contagem ser exato
    const ip = ipKeyGenerator('::ffff:127.0.0.1', 64);
    await limites.cadastro.resetKey(ip);
    await limites.cadastroComErro.resetKey(ip);
  });

  it('10 erros em /me/email/confirmar não bloqueiam PATCH /me/senha nem DELETE /me', async () => {
    const token = (await cadastrar('Ana', 'bucket@keepit.test')).body.token;
    const confirmar = () => request(app).post('/me/email/confirmar').set(comToken(token)).send({ codigo: '123456' });
    for (let i = 0; i < 10; i++) expect((await confirmar()).status).toBe(400);
    expect((await confirmar()).status).toBe(429);
    const alt = await request(app)
      .patch('/me/senha')
      .set(comToken(token))
      .send({ senhaAtual: SENHA, novaSenha: 'nova-senha-2', confirmarSenha: 'nova-senha-2' });
    expect(alt.status).toBe(200);
    const exc = await request(app).delete('/me').set(comToken(alt.body.token)).send({ senha: 'nova-senha-2' });
    expect(exc.status).toBe(204);
  });

  it('PATCH /me/senha com senha errada 10 vezes bloqueia só essa rota, por usuário', async () => {
    const token = (await cadastrar('Ana', 'senha@keepit.test')).body.token;
    const alterar = () =>
      request(app).patch('/me/senha').set(comToken(token)).send({ senhaAtual: 'errada-123', novaSenha: 'nova-senha-2', confirmarSenha: 'nova-senha-2' });
    for (let i = 0; i < 10; i++) expect((await alterar()).status).toBe(401);
    const bloq = await alterar();
    expect(bloq.status).toBe(429);
    expect(bloq.body.error).toBe('MUITAS_TENTATIVAS');
    const conf = await request(app).post('/me/email/confirmar').set(comToken(token)).send({ codigo: '123456' });
    expect(conf.status).toBe(400);
  });

  it('cadastro: erros 409/422 não gastam as 10 criações por hora; a 11ª criação dá 429', async () => {
    const invalido = () => request(app).post('/auth/cadastro').send({ nome: '', email: 'x', senha: '1', confirmarSenha: '2' });
    for (let i = 0; i < 12; i++) expect((await invalido()).status).toBe(422);
    expect((await cadastrar('A', 'a0@keepit.test')).status).toBe(201);
    expect((await cadastrar('A', 'a0@keepit.test')).status).toBe(409);
    for (let i = 1; i < 10; i++) expect((await cadastrar('A', `a${i}@keepit.test`)).status).toBe(201);
    const bloq = await cadastrar('A', 'a10@keepit.test');
    expect(bloq.status).toBe(429);
    expect(bloq.headers['retry-after']).toBeDefined();
  });
});

describe('defeito 8: segredos', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(40),
    JOBS_TOKEN: 'y'.repeat(40),
    S3_BUCKET: 'b',
    S3_ACCESS_KEY_ID: 'a',
    S3_SECRET_ACCESS_KEY: 's',
  };
  const prod = { ...base, NODE_ENV: 'production', CODIGO_SECRET: 'z'.repeat(40), PAGAMENTO_SIMULADO: 'false' };

  it('recusa JWT_SECRET e JOBS_TOKEN com menos de 32 caracteres', () => {
    expect(envSchema.safeParse({ ...base, JWT_SECRET: 'curto-demais-16ch' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, JOBS_TOKEN: 'troque-por-outro-segredo-longo' }).success).toBe(false);
    expect(envSchema.safeParse(base).success).toBe(true);
  });

  it('em produção recusa o valor de exemplo do .env.example', () => {
    expect(envSchema.safeParse(prod).success).toBe(true);
    expect(envSchema.safeParse({ ...prod, JWT_SECRET: 'troque-por-um-segredo-longo-e-aleatorio' }).success).toBe(false);
    expect(envSchema.safeParse({ ...prod, JOBS_TOKEN: 'troque-por-outro-segredo-longo-e-aleatorio' }).success).toBe(false);
  });

  it('em produção exige CODIGO_SECRET próprio, diferente do JWT_SECRET', () => {
    expect(envSchema.safeParse({ ...prod, CODIGO_SECRET: undefined }).success).toBe(false);
    expect(envSchema.safeParse({ ...prod, CODIGO_SECRET: prod.JWT_SECRET }).success).toBe(false);
  });

  it('em produção não deixa desligar o rate limit', () => {
    expect(envSchema.safeParse({ ...prod, RATE_LIMIT_DESLIGADO: 'true' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, RATE_LIMIT_DESLIGADO: 'true' }).success).toBe(true);
  });
});

describe('defeito 10: /internal/jobs', () => {
  it('chave de tamanho diferente ou vazia é recusada; o alias /jobs/run não existe mais', async () => {
    expect((await request(app).post('/internal/jobs').set('x-jobs-token', 'curta')).status).toBe(401);
    expect((await request(app).post('/internal/jobs').set('x-jobs-token', env.JOBS_TOKEN + 'x')).status).toBe(401);
    expect((await request(app).post('/internal/jobs').set('x-jobs-token', env.JOBS_TOKEN)).status).toBe(200);
    const antigo = await request(app).post('/jobs/run').set('x-jobs-token', env.JOBS_TOKEN);
    expect(antigo.status).toBe(404);
  });
});

describe('defeito 12: nome sem < > nem caracteres de controle', () => {
  it.each(['<b>Ana</b>', 'Ana\nSouza', 'Ana\u0007', 'Ana > Bia'])('422 no cadastro e na edição para %j', async (nome) => {
    const cad = await request(app).post('/auth/cadastro').send({ nome, email: 'n@keepit.test', senha: SENHA, confirmarSenha: SENHA });
    expect(cad.status).toBe(422);
    expect(cad.body.details[0].campo).toBe('nome');
    const token = (await cadastrar()).body.token;
    expect((await request(app).patch('/me').set(comToken(token)).send({ nome })).status).toBe(422);
  });

  it('aceita nomes comuns com acento, apóstrofo e hífen', async () => {
    const res = await cadastrar("Maria D'Ávila-Souza");
    expect(res.status).toBe(201);
  });
});

describe('defeito 13: alerta de exclusão perto de estourar as 24 h', () => {
  it('registra alerta com ids (sem dados pessoais) para pedidos pendentes há mais de 20 h', async () => {
    await cadastrar();
    await cadastrar('Bia', 'bia@keepit.test');
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await prisma.usuario.update({ where: { email: 'ana@keepit.test' }, data: { exclusaoSolicitadaEm: new Date(Date.now() - 21 * 3_600_000) } });
    await prisma.usuario.update({ where: { email: 'bia@keepit.test' }, data: { exclusaoSolicitadaEm: new Date(Date.now() - 2 * 3_600_000) } });
    expect(await alertarExclusoesAtrasadas()).toBe(1);
    const msg = String(erro.mock.calls[0]?.[0]);
    expect(msg).toContain('ALERTA RNF16');
    expect(msg).not.toContain('keepit.test');
    erro.mockRestore();
  });
});

describe('defeito 14: endurecimentos', () => {
  it('senha limitada em BYTES (72): 37 letras acentuadas = 74 bytes é recusada; 72 ASCII passa', async () => {
    const longa = 'á'.repeat(37);
    const r1 = await request(app).post('/auth/cadastro').send({ nome: 'Ana', email: 'b1@keepit.test', senha: longa, confirmarSenha: longa });
    expect(r1.status).toBe(422);
    expect(r1.body.details[0].campo).toBe('senha');
    const ok = 'a'.repeat(72);
    const r2 = await request(app).post('/auth/cadastro').send({ nome: 'Ana', email: 'b2@keepit.test', senha: ok, confirmarSenha: ok });
    expect(r2.status).toBe(201);
    expect((await login('b2@keepit.test', ok)).status).toBe(200);
  });

  it('CORS: aceita as origens da lista, recusa as outras e não liga credentials', async () => {
    const permitida = env.CORS_ORIGIN.split(',')[0]!.trim();
    const ok = await request(app).get('/health').set('Origin', permitida);
    expect(ok.headers['access-control-allow-origin']).toBe(permitida);
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();
    const nao = await request(app).get('/health').set('Origin', 'https://atacante.example');
    expect(nao.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('descreverErro não vaza argumentos de consulta do Prisma', () => {
    const e = new Error('Invalid `prisma.usuario.create()` invocation: email: "segredo@x.com"');
    e.name = 'PrismaClientKnownRequestError';
    Object.assign(e, { code: 'P2002' });
    const texto = descreverErro(e);
    expect(texto).toContain('P2002');
    expect(texto).not.toContain('segredo@x.com');
  });

  it('JWT com alg none ou HS256 assinado com outra chave é recusado (NAO_AUTENTICADO)', async () => {
    const { body } = await cadastrar();
    const id = body.usuario.id as number;
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const agora = Math.floor(Date.now() / 1000);
    const semAssinatura = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: String(id), iat: agora + 5, iatMs: Date.now() + 5000, exp: agora + 3600 })}.`;
    const outraChave = jwt.sign({ iatMs: Date.now() + 5000 }, 'x'.repeat(40), { subject: String(id) });
    for (const t of [semAssinatura, outraChave]) {
      const res = await request(app).get('/me').set(comToken(t));
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('NAO_AUTENTICADO');
    }
    expect((await request(app).get('/me').set(comToken(assinarToken(id)))).status).toBe(200);
  });
});
