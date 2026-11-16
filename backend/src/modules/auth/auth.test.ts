import request from 'supertest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';
import { caixaDeSaida } from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';
import { apagarObjetos, listarObjetos, prefixoRaizDaCasa } from '../../lib/s3.js';
import { limparBanco } from '../../test/db.js';
import { PNG_1X1, enviarFotoConfirmadaDeTeste, enviarObjetoDeTeste } from '../../test/produtos.js';
import { apagarContasVencidas } from './auth.service.js';

const SENHA = 'senha-forte-1';

async function cadastrar(dados: Partial<{ nome: string; email: string; senha: string }> = {}) {
  const senha = dados.senha ?? SENHA;
  const res = await request(app)
    .post('/auth/cadastro')
    .send({ nome: dados.nome ?? 'Ana Souza', email: dados.email ?? 'ana@keepit.test', senha, confirmarSenha: senha });
  return res;
}

const comToken = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Último código de 6 dígitos enviado para o endereço. */
function ultimoCodigo(para: string): string {
  const email = [...caixaDeSaida].reverse().find((e) => e.para === para);
  const codigo = email?.texto.match(/\b\d{6}\b/)?.[0];
  if (!codigo) throw new Error(`Nenhum e-mail com código para ${para}`);
  return codigo;
}

beforeEach(async () => {
  await limparBanco();
  caixaDeSaida.length = 0;
});
afterAll(() => prisma.$disconnect());

describe('POST /auth/cadastro', () => {
  it('201 cria usuário, Casa Individual e vínculo ADMIN numa transação, sem assinatura (RF32)', async () => {
    const res = await cadastrar();
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.usuario).toMatchObject({
      nome: 'Ana Souza',
      email: 'ana@keepit.test',
      papel: 'ADMIN',
      casa: { nome: 'Casa de Ana', totalMembros: 1 },
      plano: { nome: 'INDIVIDUAL', preco: '0.00', limiteMembros: 1, limiteArmazenamentoGb: 1 },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/senha|hash/i);
    expect(await prisma.casa.count()).toBe(1);
    expect(await prisma.membro.count({ where: { papel: 'ADMIN' } })).toBe(1);
    expect(await prisma.assinatura.count()).toBe(0);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana@keepit.test' } });
    expect(u.senhaHash).not.toBe(SENHA);
    expect(u.senhaHash.startsWith('$2')).toBe(true);
    expect(await prisma.logAuditoria.count({ where: { acao: 'CONTA_CRIADA' } })).toBe(1);
  });

  it('o token devolvido já funciona no GET /me', async () => {
    const { body } = await cadastrar();
    const me = await request(app).get('/me').set(comToken(body.token));
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('ana@keepit.test');
  });

  it('normaliza o e-mail e usa só o primeiro nome na Casa', async () => {
    const res = await cadastrar({ nome: '  Maria Clara  ', email: '  Maria@KeepIt.Test ' });
    expect(res.status).toBe(201);
    expect(res.body.usuario.email).toBe('maria@keepit.test');
    expect(res.body.usuario.nome).toBe('Maria Clara');
    expect(res.body.usuario.casa.nome).toBe('Casa de Maria');
  });

  it('409 EMAIL_EM_USO (mesmo com maiúsculas) e nada é criado', async () => {
    await cadastrar();
    const res = await cadastrar({ email: 'ANA@keepit.test', nome: 'Outra' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EMAIL_EM_USO');
    expect(await prisma.usuario.count()).toBe(1);
    expect(await prisma.casa.count()).toBe(1);
  });

  it('422 com senha curta, e-mail inválido, nome vazio e confirmação diferente', async () => {
    const res = await request(app)
      .post('/auth/cadastro')
      .send({ nome: '', email: 'x', senha: '1234567', confirmarSenha: '1234567' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('DADOS_INVALIDOS');
    const campos = res.body.details.map((d: { campo: string }) => d.campo);
    expect(campos).toEqual(expect.arrayContaining(['nome', 'email', 'senha']));

    const dif = await request(app)
      .post('/auth/cadastro')
      .send({ nome: 'Ana', email: 'a@keepit.test', senha: SENHA, confirmarSenha: 'outra-senha-1' });
    expect(dif.status).toBe(422);
    expect(dif.body.details).toEqual([{ campo: 'confirmarSenha', mensagem: 'As senhas não conferem' }]);
    expect(await prisma.usuario.count()).toBe(0);
  });

  it('400 REQUISICAO_INVALIDA com JSON malformado', async () => {
    const res = await request(app).post('/auth/cadastro').set('Content-Type', 'application/json').send('{ruim');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('REQUISICAO_INVALIDA');
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await cadastrar();
  });

  it('200 devolve token e perfil', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'ANA@keepit.test', senha: SENHA });
    expect(res.status).toBe(200);
    expect(res.body.usuario.casa.nome).toBe('Casa de Ana');
    const me = await request(app).get('/me').set(comToken(res.body.token));
    expect(me.status).toBe(200);
  });

  it('401 CREDENCIAIS_INVALIDAS igual para senha errada e e-mail inexistente', async () => {
    const a = await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: 'errada-errada' });
    const b = await request(app).post('/auth/login').send({ email: 'nao@keepit.test', senha: SENHA });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
    expect(a.body.error).toBe('CREDENCIAIS_INVALIDAS');
  });

  it('401 CREDENCIAIS_INVALIDAS para conta com exclusão solicitada', async () => {
    await prisma.usuario.update({ where: { email: 'ana@keepit.test' }, data: { exclusaoSolicitadaEm: new Date() } });
    const res = await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: SENHA });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('CREDENCIAIS_INVALIDAS');
  });

  it('422 com corpo inválido', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'ana', senha: '' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('DADOS_INVALIDOS');
  });

  it('429 MUITAS_TENTATIVAS após 10 falhas (RNF14), com Retry-After', async () => {
    process.env.TESTAR_RATE_LIMIT = '1';
    try {
      const tentar = () => request(app).post('/auth/login').send({ email: 'limite@keepit.test', senha: 'qualquer-uma' });
      for (let i = 0; i < 10; i++) expect((await tentar()).status).toBe(401);
      const res = await tentar();
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('MUITAS_TENTATIVAS');
      expect(res.headers['retry-after']).toBeDefined();
    } finally {
      delete process.env.TESTAR_RATE_LIMIT;
    }
  });
});

describe('autenticação (rotas protegidas)', () => {
  it('401 NAO_AUTENTICADO sem token e com token malformado', async () => {
    const a = await request(app).get('/me');
    expect(a.status).toBe(401);
    expect(a.body.error).toBe('NAO_AUTENTICADO');
    const b = await request(app).get('/me').set(comToken('lixo'));
    expect(b.status).toBe(401);
    expect(b.body.error).toBe('NAO_AUTENTICADO');
  });
});

describe('GET /me e PATCH /me', () => {
  it('200 perfil do usuário logado e 401 sem token', async () => {
    const { body } = await cadastrar();
    const res = await request(app).get('/me').set(comToken(body.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body.usuario);
  });

  it('plano reflete a assinatura vigente da Casa', async () => {
    const { body } = await cadastrar();
    const plano = await prisma.plano.findUniqueOrThrow({ where: { nome: 'FAMILIA' } });
    await prisma.assinatura.create({
      data: {
        casaId: body.usuario.casa.id,
        planoId: plano.id,
        titularId: body.usuario.id,
        status: 'ATIVA',
        dataRenovacao: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    const res = await request(app).get('/me').set(comToken(body.token));
    expect(res.body.plano).toMatchObject({ nome: 'FAMILIA', preco: '19.90', limiteMembros: 6 });
  });

  it('PATCH altera só o nome (e-mail e demais campos enviados são ignorados)', async () => {
    const { body } = await cadastrar();
    const res = await request(app)
      .patch('/me')
      .set(comToken(body.token))
      .send({ nome: '  Ana Maria  ', email: 'hack@keepit.test' });
    expect(res.status).toBe(200);
    expect(res.body.nome).toBe('Ana Maria');
    expect(res.body.email).toBe('ana@keepit.test');
  });

  it('PATCH 422 com nome vazio ou longo e 401 sem token', async () => {
    const { body } = await cadastrar();
    const a = await request(app).patch('/me').set(comToken(body.token)).send({ nome: '   ' });
    expect(a.status).toBe(422);
    const b = await request(app).patch('/me').set(comToken(body.token)).send({ nome: 'x'.repeat(81) });
    expect(b.status).toBe(422);
    const c = await request(app).patch('/me').send({ nome: 'Ana' });
    expect(c.status).toBe(401);
  });

  it('funciona para EDITOR e LEITOR (todos os papéis)', async () => {
    const { body } = await cadastrar();
    await prisma.membro.update({ where: { usuarioId: body.usuario.id }, data: { papel: 'LEITOR' } });
    const res = await request(app).get('/me').set(comToken(body.token));
    expect(res.status).toBe(200);
    expect(res.body.papel).toBe('LEITOR');
  });
});

describe('POST /auth/logout', () => {
  it('204 e o token (e outros emitidos antes) deixam de valer; registra auditoria', async () => {
    const { body } = await cadastrar();
    const outro = await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: SENHA });
    const res = await request(app).post('/auth/logout').set(comToken(body.token));
    expect(res.status).toBe(204);
    for (const t of [body.token, outro.body.token]) {
      const me = await request(app).get('/me').set(comToken(t));
      expect(me.status).toBe(401);
      expect(me.body.error).toBe('SESSAO_EXPIRADA');
    }
    expect(await prisma.logAuditoria.count({ where: { acao: 'SESSAO_ENCERRADA' } })).toBe(1);
  });

  it('permite novo login depois do logout', async () => {
    const { body } = await cadastrar();
    await request(app).post('/auth/logout').set(comToken(body.token));
    const login = await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: SENHA });
    const me = await request(app).get('/me').set(comToken(login.body.token));
    expect(me.status).toBe(200);
  });

  it('401 sem token', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(401);
  });
});

describe('recuperação de senha', () => {
  beforeEach(async () => {
    await cadastrar();
  });

  async function pedir(email = 'ana@keepit.test') {
    return request(app).post('/auth/recuperar-senha').send({ email });
  }
  const redefinir = (codigo: string, novaSenha = 'nova-senha-2', email = 'ana@keepit.test') =>
    request(app).post('/auth/redefinir-senha').send({ email, codigo, novaSenha, confirmarSenha: novaSenha });

  it('200 envia código de 6 dígitos por e-mail e grava só o hash, com 15 min de validade', async () => {
    const res = await pedir();
    expect(res.status).toBe(200);
    const minutos = (new Date(res.body.expiraEm).getTime() - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(14);
    expect(minutos).toBeLessThanOrEqual(15);
    const codigo = ultimoCodigo('ana@keepit.test');
    expect(codigo).toMatch(/^\d{6}$/);
    const reg = await prisma.codigoVerificacao.findFirstOrThrow({ where: { finalidade: 'RECUPERAR_SENHA' } });
    expect(reg.codigoHash).not.toContain(codigo);
    expect(reg.usadoEm).toBeNull();
  });

  it('404 CONTA_NAO_ENCONTRADA para e-mail sem conta e para conta em exclusão', async () => {
    const a = await pedir('nao@keepit.test');
    expect(a.status).toBe(404);
    expect(a.body.error).toBe('CONTA_NAO_ENCONTRADA');
    await prisma.usuario.update({ where: { email: 'ana@keepit.test' }, data: { exclusaoSolicitadaEm: new Date() } });
    expect((await pedir()).status).toBe(404);
    expect(caixaDeSaida).toHaveLength(0);
  });

  it('422 com e-mail inválido', async () => {
    expect((await pedir('xx')).status).toBe(422);
  });

  it('204 redefine, troca a hash, consome o código, não loga e encerra sessões antigas', async () => {
    const { body } = await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: SENHA });
    await pedir();
    const codigo = ultimoCodigo('ana@keepit.test');
    const res = await redefinir(codigo);
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});

    expect((await request(app).get('/me').set(comToken(body.token))).status).toBe(401);
    expect((await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: SENHA })).status).toBe(401);
    const novo = await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: 'nova-senha-2' });
    expect(novo.status).toBe(200);
    expect((await request(app).get('/me').set(comToken(novo.body.token))).status).toBe(200);
    expect(await prisma.logAuditoria.count({ where: { acao: 'SENHA_REDEFINIDA' } })).toBe(1);
  });

  it('400 CODIGO_INVALIDO para código errado (senha não muda)', async () => {
    await pedir();
    const certo = ultimoCodigo('ana@keepit.test');
    const errado = certo === '000000' ? '111111' : '000000';
    const res = await redefinir(errado);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CODIGO_INVALIDO');
    expect((await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: SENHA })).status).toBe(200);
  });

  it('400 CODIGO_INVALIDO para uso único (segunda vez)', async () => {
    await pedir();
    const codigo = ultimoCodigo('ana@keepit.test');
    expect((await redefinir(codigo)).status).toBe(204);
    const res = await redefinir(codigo, 'outra-senha-3');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CODIGO_INVALIDO');
  });

  it('400 CODIGO_INVALIDO para código expirado', async () => {
    await pedir();
    const codigo = ultimoCodigo('ana@keepit.test');
    await prisma.codigoVerificacao.updateMany({ data: { expiraEm: new Date(Date.now() - 1000) } });
    const res = await redefinir(codigo);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CODIGO_INVALIDO');
  });

  it('um novo pedido invalida o código anterior', async () => {
    await pedir();
    const primeiro = ultimoCodigo('ana@keepit.test');
    await pedir();
    const segundo = ultimoCodigo('ana@keepit.test');
    if (primeiro !== segundo) {
      expect((await redefinir(primeiro)).status).toBe(400);
    }
    expect((await redefinir(segundo)).status).toBe(204);
  });

  it('400 CODIGO_INVALIDO (sem enumeração) para e-mail sem conta', async () => {
    const res = await redefinir('123456', 'nova-senha-2', 'nao@keepit.test');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CODIGO_INVALIDO');
  });

  it('422 com senha curta, confirmação diferente ou código mal formado', async () => {
    const curta = await request(app)
      .post('/auth/redefinir-senha')
      .send({ email: 'ana@keepit.test', codigo: '123456', novaSenha: 'curta', confirmarSenha: 'curta' });
    expect(curta.status).toBe(422);
    const dif = await request(app)
      .post('/auth/redefinir-senha')
      .send({ email: 'ana@keepit.test', codigo: '123456', novaSenha: 'nova-senha-2', confirmarSenha: 'diferente-2' });
    expect(dif.status).toBe(422);
    const cod = await redefinir('12ab');
    expect(cod.status).toBe(422);
  });

  it('código de recuperação não vale para trocar e-mail (finalidades separadas)', async () => {
    await pedir();
    const codigo = ultimoCodigo('ana@keepit.test');
    const { body } = await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: SENHA });
    await request(app).post('/me/email').set(comToken(body.token)).send({ email: 'novo@keepit.test', senhaAtual: SENHA });
    const res = await request(app).post('/me/email/confirmar').set(comToken(body.token)).send({ codigo });
    // Só passa se, por coincidência, os dois códigos forem iguais; hashes têm finalidades diferentes.
    if (ultimoCodigo('novo@keepit.test') !== codigo) expect(res.status).toBe(400);
  });
});

describe('troca de e-mail', () => {
  let token: string;
  beforeEach(async () => {
    token = (await cadastrar()).body.token;
  });
  const pedir = (email: string, senhaAtual = SENHA) =>
    request(app).post('/me/email').set(comToken(token)).send({ email, senhaAtual });
  const confirmar = (codigo: string, t = token) =>
    request(app).post('/me/email/confirmar').set(comToken(t)).send({ codigo });

  it('200 envia o código ao NOVO e-mail; o atual continua valendo até confirmar', async () => {
    const res = await pedir('Novo@KeepIt.test');
    expect(res.status).toBe(200);
    expect(res.body.expiraEm).toBeDefined();
    expect(caixaDeSaida.some((e) => e.para === 'novo@keepit.test' && /\b\d{6}\b/.test(e.texto))).toBe(true);
    const me = await request(app).get('/me').set(comToken(token));
    expect(me.body.email).toBe('ana@keepit.test');
  });

  it('confirmar com o código troca o e-mail, devolve token novo, encerra as outras sessões e exige o novo e-mail no login', async () => {
    const outraSessao = (await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: SENHA })).body.token;
    await pedir('novo@keepit.test');
    const res = await confirmar(ultimoCodigo('novo@keepit.test'));
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('novo@keepit.test');
    expect(typeof res.body.token).toBe('string');
    // a sessão que confirmou continua (token novo, no mesmo segundo); o token antigo e as outras sessões caem
    expect((await request(app).get('/me').set(comToken(res.body.token))).status).toBe(200);
    expect((await request(app).get('/me').set(comToken(token))).status).toBe(401);
    expect((await request(app).get('/me').set(comToken(outraSessao))).status).toBe(401);
    expect((await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: SENHA })).status).toBe(401);
    expect((await request(app).post('/auth/login').send({ email: 'novo@keepit.test', senha: SENHA })).status).toBe(200);
    expect(await prisma.logAuditoria.count({ where: { acao: 'EMAIL_ALTERADO' } })).toBe(1);
  });

  it('409 EMAIL_EM_USO ao pedir e-mail de outra conta (nenhum código é enviado)', async () => {
    await cadastrar({ nome: 'Bia', email: 'bia@keepit.test' });
    caixaDeSaida.length = 0;
    const res = await pedir('bia@keepit.test');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EMAIL_EM_USO');
    expect(caixaDeSaida).toHaveLength(0);
  });

  it('422 com e-mail igual ao atual ou inválido', async () => {
    const igual = await pedir('ana@keepit.test');
    expect(igual.status).toBe(422);
    expect(igual.body.details[0].campo).toBe('email');
    expect((await pedir('xx')).status).toBe(422);
  });

  it('400 CODIGO_INVALIDO com código errado, sem pedido pendente, usado ou expirado', async () => {
    expect((await confirmar('123456')).status).toBe(400);
    await pedir('novo@keepit.test');
    const codigo = ultimoCodigo('novo@keepit.test');
    const errado = codigo === '000000' ? '111111' : '000000';
    expect((await confirmar(errado)).body.error).toBe('CODIGO_INVALIDO');
    const ok = await confirmar(codigo);
    expect(ok.status).toBe(200);
    token = ok.body.token; // a confirmação encerra as sessões anteriores
    expect((await confirmar(codigo)).status).toBe(400); // uso único

    await pedir('outro@keepit.test');
    await prisma.codigoVerificacao.updateMany({ where: { usadoEm: null }, data: { expiraEm: new Date(Date.now() - 1000) } });
    expect((await confirmar(ultimoCodigo('outro@keepit.test'))).status).toBe(400);
  });

  it('409 EMAIL_EM_USO se outra conta ficou com o e-mail antes da confirmação', async () => {
    await pedir('disputa@keepit.test');
    const codigo = ultimoCodigo('disputa@keepit.test');
    await cadastrar({ nome: 'Caio', email: 'disputa@keepit.test' });
    const res = await confirmar(codigo);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EMAIL_EM_USO');
    const me = await request(app).get('/me').set(comToken(token));
    expect(me.body.email).toBe('ana@keepit.test');
  });

  it('um novo pedido invalida o pedido anterior', async () => {
    await pedir('a1@keepit.test');
    const c1 = ultimoCodigo('a1@keepit.test');
    await pedir('a2@keepit.test');
    const c2 = ultimoCodigo('a2@keepit.test');
    if (c1 !== c2) expect((await confirmar(c1)).status).toBe(400);
    const res = await confirmar(c2);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('a2@keepit.test');
  });

  it('401 sem token', async () => {
    expect((await request(app).post('/me/email').send({ email: 'x@keepit.test' })).status).toBe(401);
    expect((await request(app).post('/me/email/confirmar').send({ codigo: '123456' })).status).toBe(401);
  });
});

describe('PATCH /me/senha', () => {
  let token: string;
  beforeEach(async () => {
    token = (await cadastrar()).body.token;
  });
  const alterar = (corpo: object, t = token) => request(app).patch('/me/senha').set(comToken(t)).send(corpo);

  it('200 troca a senha, devolve token novo e encerra as outras sessões', async () => {
    const outra = await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: SENHA });
    const res = await alterar({ senhaAtual: SENHA, novaSenha: 'nova-senha-2', confirmarSenha: 'nova-senha-2' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect((await request(app).get('/me').set(comToken(res.body.token))).status).toBe(200);
    expect((await request(app).get('/me').set(comToken(outra.body.token))).status).toBe(401);
    expect((await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: SENHA })).status).toBe(401);
    expect((await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: 'nova-senha-2' })).status).toBe(200);
    expect(await prisma.logAuditoria.count({ where: { acao: 'SENHA_ALTERADA' } })).toBe(1);
  });

  it('401 SENHA_INCORRETA com a senha atual errada (e a senha não muda)', async () => {
    const res = await alterar({ senhaAtual: 'errada-errada', novaSenha: 'nova-senha-2', confirmarSenha: 'nova-senha-2' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('SENHA_INCORRETA');
    expect((await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: SENHA })).status).toBe(200);
  });

  it('422 SENHA_IGUAL_ATUAL quando a nova é igual à atual', async () => {
    const res = await alterar({ senhaAtual: SENHA, novaSenha: SENHA, confirmarSenha: SENHA });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('SENHA_IGUAL_ATUAL');
  });

  it('422 DADOS_INVALIDOS com senha curta ou confirmação diferente (validação vem antes da senha atual)', async () => {
    const curta = await alterar({ senhaAtual: 'errada', novaSenha: 'curta', confirmarSenha: 'curta' });
    expect(curta.status).toBe(422);
    expect(curta.body.error).toBe('DADOS_INVALIDOS');
    const dif = await alterar({ senhaAtual: SENHA, novaSenha: 'nova-senha-2', confirmarSenha: 'outra-senha-3' });
    expect(dif.status).toBe(422);
  });

  it('401 sem token', async () => {
    const res = await request(app)
      .patch('/me/senha')
      .send({ senhaAtual: SENHA, novaSenha: 'nova-senha-2', confirmarSenha: 'nova-senha-2' });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /me', () => {
  let token: string;
  beforeEach(async () => {
    token = (await cadastrar()).body.token;
  });
  const excluir = (senha: string, t = token) => request(app).delete('/me').set(comToken(t)).send({ senha });

  it('204 marca exclusaoSolicitadaEm, bloqueia login e sessões e audita', async () => {
    const res = await excluir(SENHA);
    expect(res.status).toBe(204);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana@keepit.test' } });
    expect(u.exclusaoSolicitadaEm).not.toBeNull();
    const me = await request(app).get('/me').set(comToken(token));
    expect(me.status).toBe(401);
    expect(me.body.error).toBe('SESSAO_EXPIRADA');
    const login = await request(app).post('/auth/login').send({ email: 'ana@keepit.test', senha: SENHA });
    expect(login.status).toBe(401);
    expect(login.body.error).toBe('CREDENCIAIS_INVALIDAS');
    expect(await prisma.logAuditoria.count({ where: { acao: 'EXCLUSAO_SOLICITADA' } })).toBe(1);
  });

  it('o e-mail continua reservado até o apagamento (409 no cadastro)', async () => {
    await excluir(SENHA);
    expect((await cadastrar()).status).toBe(409);
  });

  it('401 SENHA_INCORRETA mantém a conta ativa', async () => {
    const res = await excluir('errada-errada');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('SENHA_INCORRETA');
    expect((await request(app).get('/me').set(comToken(token))).status).toBe(200);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana@keepit.test' } });
    expect(u.exclusaoSolicitadaEm).toBeNull();
  });

  it('422 sem senha e 401 sem token', async () => {
    expect((await request(app).delete('/me').set(comToken(token)).send({})).status).toBe(422);
    expect((await request(app).delete('/me').send({ senha: SENHA })).status).toBe(401);
  });
});

describe('rotina de exclusão definitiva (8.3.2)', () => {
  async function solicitarExclusaoHa(email: string, horas: number) {
    await prisma.usuario.update({
      where: { email },
      data: { exclusaoSolicitadaEm: new Date(Date.now() - horas * 3_600_000) },
    });
  }

  it('apaga dados pessoais e a Casa vazia após 23 h; preserva logs sem usuarioId; libera o e-mail', async () => {
    const { body } = await cadastrar();
    await request(app).post('/auth/recuperar-senha').send({ email: 'ana@keepit.test' }).catch(() => undefined);
    await solicitarExclusaoHa('ana@keepit.test', 25);
    expect(await apagarContasVencidas()).toBe(1);
    expect(await prisma.usuario.count()).toBe(0);
    expect(await prisma.membro.count()).toBe(0);
    expect(await prisma.casa.count()).toBe(0);
    expect(await prisma.codigoVerificacao.count()).toBe(0);
    const logs = await prisma.logAuditoria.findMany();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.usuarioId === null)).toBe(true);
    expect(logs.some((l) => l.acao === 'CONTA_APAGADA' && l.entidadeId === body.usuario.id)).toBe(true);
    expect((await cadastrar()).status).toBe(201);
  });

  it('não toca contas com exclusão solicitada há menos de 23 h nem contas normais', async () => {
    await cadastrar();
    await cadastrar({ nome: 'Bia', email: 'bia@keepit.test' });
    await solicitarExclusaoHa('ana@keepit.test', 22.5);
    expect(await apagarContasVencidas()).toBe(0);
    expect(await prisma.usuario.count()).toBe(2);
  });

  it('com a rotina horária, um pedido feito há 23,5 h já é apagado (garante o prazo de 24 h do RNF16)', async () => {
    await cadastrar();
    await solicitarExclusaoHa('ana@keepit.test', 23.5);
    expect(await apagarContasVencidas()).toBe(1);
  });

  it('produtos ficam na Casa com autor vazio quando ela tem outros membros', async () => {
    const ana = (await cadastrar()).body;
    const bia = (await cadastrar({ nome: 'Bia', email: 'bia@keepit.test' })).body;
    // Bia passa a ser membro da Casa de Ana (cenário de M2, montado direto no banco).
    await prisma.membro.update({ where: { usuarioId: bia.usuario.id }, data: { casaId: ana.usuario.casa.id, papel: 'EDITOR' } });
    await prisma.casa.delete({ where: { id: bia.usuario.casa.id } });
    await prisma.produto.create({
      data: { casaId: ana.usuario.casa.id, adicionadoPorId: bia.usuario.id, nome: 'TV', preco: '1000.00', dataCompra: new Date() },
    });
    await solicitarExclusaoHa('bia@keepit.test', 30);
    expect(await apagarContasVencidas()).toBe(1);
    expect(await prisma.casa.count({ where: { id: ana.usuario.casa.id } })).toBe(1);
    const produto = await prisma.produto.findFirstOrThrow();
    expect(produto.adicionadoPorId).toBeNull();
  });

  it('apaga a Casa vazia junto com produtos e assinatura', async () => {
    const { body } = await cadastrar();
    const plano = await prisma.plano.findUniqueOrThrow({ where: { nome: 'FAMILIA' } });
    await prisma.assinatura.create({
      data: { casaId: body.usuario.casa.id, planoId: plano.id, titularId: body.usuario.id, status: 'ATIVA', dataRenovacao: new Date() },
    });
    await prisma.produto.create({
      data: { casaId: body.usuario.casa.id, adicionadoPorId: body.usuario.id, nome: 'TV', preco: '1.00', dataCompra: new Date() },
    });
    await solicitarExclusaoHa('ana@keepit.test', 25);
    expect(await apagarContasVencidas()).toBe(1);
    expect(await prisma.produto.count()).toBe(0);
    expect(await prisma.assinatura.count()).toBe(0);
  });

  it('LGPD: ao apagar a Casa, apaga também os arquivos dela no S3 (fotos e envios pendentes), sem tocar em outra Casa', async () => {
    const ana = (await cadastrar()).body;
    const outra = (await cadastrar({ nome: 'Caio', email: 'caio@keepit.test' })).body;
    const casaId = ana.usuario.casa.id as number;
    const foto = await enviarFotoConfirmadaDeTeste(casaId, PNG_1X1);
    const pendente = await enviarObjetoDeTeste(casaId, PNG_1X1);
    const deOutra = await enviarFotoConfirmadaDeTeste(outra.usuario.casa.id, PNG_1X1);
    const chaves = async (id: number) => (await listarObjetos(prefixoRaizDaCasa(id))).objetos.map((o) => o.chave);
    try {
      expect(await chaves(casaId)).toEqual(expect.arrayContaining([foto, pendente]));
      await solicitarExclusaoHa('ana@keepit.test', 25);
      expect(await apagarContasVencidas()).toBe(1);
      expect(await prisma.casa.count({ where: { id: casaId } })).toBe(0);
      expect(await chaves(casaId)).toEqual([]);
      expect(await chaves(outra.usuario.casa.id)).toContain(deOutra);
    } finally {
      await apagarObjetos([foto, pendente, deOutra]);
    }
  });

  it('Casa que continua com outros membros mantém os arquivos', async () => {
    const ana = (await cadastrar()).body;
    const bia = (await cadastrar({ nome: 'Bia', email: 'bia@keepit.test' })).body;
    await prisma.membro.update({ where: { usuarioId: bia.usuario.id }, data: { casaId: ana.usuario.casa.id, papel: 'EDITOR' } });
    await prisma.casa.delete({ where: { id: bia.usuario.casa.id } });
    const foto = await enviarFotoConfirmadaDeTeste(ana.usuario.casa.id, PNG_1X1);
    try {
      await solicitarExclusaoHa('bia@keepit.test', 30);
      expect(await apagarContasVencidas()).toBe(1);
      expect((await listarObjetos(prefixoRaizDaCasa(ana.usuario.casa.id))).objetos.map((o) => o.chave)).toContain(foto);
    } finally {
      await apagarObjetos([foto]);
    }
  });

  it('é idempotente e falha de uma conta não impede as demais', async () => {
    await cadastrar();
    await cadastrar({ nome: 'Caio', email: 'caio@keepit.test' });
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await solicitarExclusaoHa('ana@keepit.test', 25);
    await solicitarExclusaoHa('caio@keepit.test', 25);
    // Gatilho temporário no banco faz o DELETE da Ana falhar (simula falha do banco): a Caio é apagada mesmo assim.
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION test.falha_ana() RETURNS trigger AS $$ BEGIN IF OLD.email = 'ana@keepit.test' THEN RAISE EXCEPTION 'falha simulada'; END IF; RETURN OLD; END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER falha_ana BEFORE DELETE ON test.usuario FOR EACH ROW EXECUTE FUNCTION test.falha_ana()`,
    );
    expect(await apagarContasVencidas()).toBe(1);
    await prisma.$executeRawUnsafe(`DROP TRIGGER falha_ana ON test.usuario`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION test.falha_ana()`);
    expect(erro).toHaveBeenCalled();
    expect(await prisma.usuario.count()).toBe(1); // a que falhou segue pendente
    expect(await apagarContasVencidas()).toBe(1); // reprocessada na execução seguinte
    expect(await apagarContasVencidas()).toBe(0); // idempotente
    erro.mockRestore();
  });

  it('titular de assinatura é apagado sem falhar: a assinatura fica sem titular (ADR 0002, D3 / ACH-08)', async () => {
    const ana = (await cadastrar()).body;
    await cadastrar({ nome: 'Bia', email: 'bia@keepit.test' });
    const bia = await prisma.usuario.findUniqueOrThrow({ where: { email: 'bia@keepit.test' } });
    await prisma.membro.update({ where: { usuarioId: bia.id }, data: { casaId: ana.usuario.casa.id, papel: 'EDITOR' } });
    const plano = await prisma.plano.findUniqueOrThrow({ where: { nome: 'FAMILIA' } });
    await prisma.assinatura.create({
      data: { casaId: ana.usuario.casa.id, planoId: plano.id, titularId: ana.usuario.id, status: 'EXPIRADA', dataRenovacao: new Date() },
    });
    await solicitarExclusaoHa('ana@keepit.test', 25);
    expect(await apagarContasVencidas()).toBe(1);
    expect((await prisma.assinatura.findFirstOrThrow()).titularId).toBeNull();
  });

  it('POST /internal/jobs executa a rotina (chave interna) e devolve a contagem', async () => {
    await cadastrar();
    await solicitarExclusaoHa('ana@keepit.test', 25);
    const sem = await request(app).post('/internal/jobs');
    expect(sem.status).toBe(401);
    const res = await request(app).post('/internal/jobs').set('x-jobs-token', env.JOBS_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiradas: 0, renovadas: 0, apagadas: 1, falhas: 0, fotosOrfasApagadas: 0, fotosOrfasPendentes: 0 });
    const outra = await request(app).post('/internal/jobs').set('x-jobs-token', env.JOBS_TOKEN);
    expect(outra.body.apagadas).toBe(0);
  });

  it('token de usuário não vale em /internal/jobs', async () => {
    const { body } = await cadastrar();
    const res = await request(app).post('/internal/jobs').set(comToken(body.token));
    expect(res.status).toBe(401);
  });
});
