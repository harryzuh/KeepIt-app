import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { autorizacao, montarCasa, testarMatrizDePapeis } from '../test/casa.js';
import { limparBanco } from '../test/db.js';
import { autenticar, usuarioDaRequisicao } from './autenticar.js';
import { autorizar, ADMIN_OU_EDITOR, QUALQUER_PAPEL, SOMENTE_ADMIN } from './autorizar.js';
import { errorHandler } from './error.js';

// RNF31 / ADR 0002 (D6): papel e Casa são lidos do banco a cada requisição; o JWT só identifica o usuário.
const app = express();
app.use(express.json());
app.get('/leitura', autenticar, autorizar(...QUALQUER_PAPEL), (req, res) => res.json(usuarioDaRequisicao(req)));
app.post('/escrita', autenticar, autorizar(...ADMIN_OU_EDITOR), (_req, res) => res.status(201).json({ ok: true }));
app.delete('/admin', autenticar, autorizar(...SOMENTE_ADMIN), (_req, res) => res.status(204).end());
app.use(errorHandler);

beforeEach(limparBanco);
afterAll(() => prisma.$disconnect());

describe('autorizar: papel na Casa do usuário logado', () => {
  it('matriz ADMIN / EDITOR / LEITOR / outra Casa / sem token', async () => {
    const casa = await montarCasa();
    await testarMatrizDePapeis(
      casa,
      (t) => request(app).delete('/admin').set(...autorizacao(t)),
      // outraCasa: é ADMIN da própria Casa, então a rota (sem recurso) o aceita; rotas com :id respondem 404
      { semToken: 401, LEITOR: 403, EDITOR: 403, outraCasa: 204, ADMIN: 204 },
    );
    await testarMatrizDePapeis(
      casa,
      (t) => request(app).post('/escrita').set(...autorizacao(t)),
      { semToken: 401, LEITOR: 403, EDITOR: 201, outraCasa: 201, ADMIN: 201 },
    );
  });

  it('a mudança de papel vale na próxima requisição com o MESMO token', async () => {
    const casa = await montarCasa();
    const { token, usuario } = casa.leitor!;
    expect((await request(app).post('/escrita').set(...autorizacao(token))).status).toBe(403);
    await prisma.membro.update({ where: { usuarioId: usuario.id }, data: { papel: 'EDITOR' } });
    expect((await request(app).post('/escrita').set(...autorizacao(token))).status).toBe(201);
    await prisma.membro.update({ where: { usuarioId: usuario.id }, data: { papel: 'LEITOR' } });
    expect((await request(app).post('/escrita').set(...autorizacao(token))).status).toBe(403);
  });

  it('a troca de Casa vale na próxima requisição: req.usuario traz a Casa nova', async () => {
    const origem = await montarCasa();
    const destino = await montarCasa({ prefixo: 'destino' });
    const { token, usuario } = origem.editor!;
    expect((await request(app).get('/leitura').set(...autorizacao(token))).body.casaId).toBe(origem.casaId);
    await prisma.membro.update({ where: { usuarioId: usuario.id }, data: { casaId: destino.casaId, papel: 'LEITOR' } });
    const depois = await request(app).get('/leitura').set(...autorizacao(token));
    expect(depois.body).toMatchObject({ casaId: destino.casaId, papel: 'LEITOR' });
  });
});
