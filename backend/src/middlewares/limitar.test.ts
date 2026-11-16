import express from 'express';
import request from 'supertest';
import { errorHandler } from './error.js';
import { limitar } from './limitar.js';

describe('limitar', () => {
  beforeAll(() => {
    process.env.TESTAR_RATE_LIMIT = '1';
  });
  afterAll(() => {
    delete process.env.TESTAR_RATE_LIMIT;
  });

  it('responde 429 MUITAS_TENTATIVAS ao passar do limite, por IP + e-mail', async () => {
    const app = express();
    app.use(express.json());
    app.post('/x', limitar({ janelaMin: 1, max: 2, porEmail: true }), (_req, res) => {
      res.status(204).end();
    });
    app.use(errorHandler);

    const chamar = (email: string) => request(app).post('/x').send({ email });
    expect((await chamar('a@x.com')).status).toBe(204);
    expect((await chamar('a@x.com')).status).toBe(204);
    const bloqueada = await chamar('A@x.com ');
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.body.error).toBe('MUITAS_TENTATIVAS');
    expect(bloqueada.headers['retry-after']).toBeDefined();
    // outro e-mail tem contador próprio
    expect((await chamar('b@x.com')).status).toBe(204);
  });

  it('com soErros só conta respostas de erro', async () => {
    const app = express();
    app.use(express.json());
    app.post('/y', limitar({ janelaMin: 1, max: 1, soErros: true }), (req, res) => {
      res.status(req.body.ok ? 200 : 401).end();
    });
    for (let i = 0; i < 3; i++) expect((await request(app).post('/y').send({ ok: true })).status).toBe(200);
    expect((await request(app).post('/y').send({ ok: false })).status).toBe(401);
    expect((await request(app).post('/y').send({ ok: false })).status).toBe(429);
  });

  it('IPv6: endereços do mesmo /64 dividem a cota; outro /64 tem a sua', async () => {
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.post('/z', limitar({ janelaMin: 1, max: 2 }), (_req, res) => {
      res.status(204).end();
    });
    const de = (ip: string) => request(app).post('/z').set('X-Forwarded-For', ip).send({});
    expect((await de('2001:db8:1:1::1')).status).toBe(204);
    expect((await de('2001:db8:1:1::ffff')).status).toBe(204);
    expect((await de('2001:db8:1:1:aaaa::2')).status).toBe(429); // mesmo /64, endereço novo
    expect((await de('2001:db8:1:2::1')).status).toBe(204); // outro /64
  });

  it('com soSucessos só conta respostas bem-sucedidas', async () => {
    const app = express();
    app.use(express.json());
    app.post('/w', limitar({ janelaMin: 1, max: 1, soSucessos: true }), (req, res) => {
      res.status(req.body.ok ? 201 : 422).end();
    });
    for (let i = 0; i < 3; i++) expect((await request(app).post('/w').send({ ok: false })).status).toBe(422);
    expect((await request(app).post('/w').send({ ok: true })).status).toBe(201);
    expect((await request(app).post('/w').send({ ok: true })).status).toBe(429);
  });

  it('com porUsuario a chave é o usuário autenticado, não o IP', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.usuario = { id: Number(req.header('x-uid')), casaId: 1, papel: 'ADMIN' };
      next();
    });
    app.post('/u', limitar({ janelaMin: 1, max: 1, porUsuario: true }), (_req, res) => {
      res.status(204).end();
    });
    const como = (id: number) => request(app).post('/u').set('x-uid', String(id)).send({});
    expect((await como(1)).status).toBe(204);
    expect((await como(1)).status).toBe(429);
    expect((await como(2)).status).toBe(204);
  });
});
