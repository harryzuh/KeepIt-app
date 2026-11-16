import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { HttpError } from '../lib/http-error.js';
import { assinarToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { criarUsuarioComCasa, limparBanco } from '../test/db.js';
import { autenticar, usuarioDaRequisicao } from './autenticar.js';
import { autorizar } from './autorizar.js';
import { errorHandler, rotaNaoEncontrada } from './error.js';
import { validar } from './validar.js';

const app = express();
app.use(express.json());
app.get('/quem', autenticar, (req, res) => {
  res.json(usuarioDaRequisicao(req));
});
app.post('/escrever', autenticar, autorizar('ADMIN', 'EDITOR'), (_req, res) => {
  res.status(201).json({ ok: true });
});
app.post(
  '/validar/:id',
  validar({
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: z.object({ n: z.coerce.number().default(1) }),
    body: z.object({ email: z.email('E-mail inválido').toLowerCase(), nome: z.string().min(1, 'Informe o nome') }),
  }),
  (req, res) => {
    res.json({ params: req.params, query: req.query, body: req.body });
  },
);
app.get('/erro-negocio', () => {
  throw new HttpError(409, 'EMAIL_EM_USO', 'E-mail em uso');
});
app.get('/erro-interno', () => {
  throw new Error('boom');
});
app.use(rotaNaoEncontrada);
app.use(errorHandler);

beforeEach(limparBanco);
afterAll(() => prisma.$disconnect());

describe('autenticar', () => {
  it('401 NAO_AUTENTICADO sem token', async () => {
    const res = await request(app).get('/quem');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'NAO_AUTENTICADO' });
  });

  it('401 NAO_AUTENTICADO com token inválido', async () => {
    const res = await request(app).get('/quem').set('Authorization', 'Bearer lixo');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NAO_AUTENTICADO');
  });

  it('carrega id, Casa e papel do usuário', async () => {
    const { usuario, casaId } = await criarUsuarioComCasa({ papel: 'LEITOR' });
    const res = await request(app).get('/quem').set('Authorization', `Bearer ${assinarToken(usuario.id)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: usuario.id, casaId, papel: 'LEITOR' });
  });

  it('401 SESSAO_EXPIRADA para token emitido antes de sessoesValidasDesde (logout)', async () => {
    const { usuario } = await criarUsuarioComCasa();
    const token = assinarToken(usuario.id);
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { sessoesValidasDesde: new Date(Date.now() + 5_000) },
    });
    const res = await request(app).get('/quem').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('SESSAO_EXPIRADA');
  });

  it('401 para conta com exclusão solicitada', async () => {
    const { usuario } = await criarUsuarioComCasa();
    await prisma.usuario.update({ where: { id: usuario.id }, data: { exclusaoSolicitadaEm: new Date() } });
    const res = await request(app).get('/quem').set('Authorization', `Bearer ${assinarToken(usuario.id)}`);
    expect(res.status).toBe(401);
  });

  it('401 para usuário inexistente', async () => {
    const res = await request(app).get('/quem').set('Authorization', `Bearer ${assinarToken(999999)}`);
    expect(res.status).toBe(401);
  });
});

describe('autorizar', () => {
  it.each([
    ['ADMIN', 201],
    ['EDITOR', 201],
    ['LEITOR', 403],
  ] as const)('papel %s -> %i', async (papel, status) => {
    const { usuario } = await criarUsuarioComCasa({ papel });
    const res = await request(app).post('/escrever').set('Authorization', `Bearer ${assinarToken(usuario.id)}`);
    expect(res.status).toBe(status);
    if (status === 403) expect(res.body.error).toBe('SEM_PERMISSAO');
  });
});

describe('validar e errorHandler', () => {
  it('422 DADOS_INVALIDOS com details por campo', async () => {
    const res = await request(app).post('/validar/1').send({ email: 'x', nome: '' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('DADOS_INVALIDOS');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        { campo: 'email', mensagem: 'E-mail inválido' },
        { campo: 'nome', mensagem: 'Informe o nome' },
      ]),
    );
  });

  it('422 para params inválidos', async () => {
    const res = await request(app).post('/validar/abc').send({ email: 'a@b.com', nome: 'A' });
    expect(res.status).toBe(422);
  });

  it('substitui body, params e query pelos valores convertidos', async () => {
    const res = await request(app).post('/validar/7?n=3').send({ email: 'ANA@X.COM', nome: 'Ana' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ params: { id: 7 }, query: { n: 3 }, body: { email: 'ana@x.com', nome: 'Ana' } });
  });

  it('HttpError vira { error, message }', async () => {
    const res = await request(app).get('/erro-negocio');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'EMAIL_EM_USO', message: 'E-mail em uso' });
  });

  it('erro inesperado vira 500 ERRO_INTERNO sem vazar detalhes', async () => {
    const res = await request(app).get('/erro-interno');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'ERRO_INTERNO', message: 'Erro interno' });
  });

  it('JSON malformado vira 400 REQUISICAO_INVALIDA', async () => {
    const res = await request(app).post('/validar/1').set('Content-Type', 'application/json').send('{ruim');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('REQUISICAO_INVALIDA');
  });

  it('rota inexistente vira 404 NAO_ENCONTRADO', async () => {
    const res = await request(app).get('/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NAO_ENCONTRADO');
  });
});
