import request from 'supertest';
import { app } from './app.js';
import { env } from './config/env.js';

describe('GET /health', () => {
  it('responde ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('POST /internal/jobs', () => {
  it('401 sem a chave interna', async () => {
    const res = await request(app).post('/internal/jobs');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NAO_AUTENTICADO');
  });

  it('401 com chave errada', async () => {
    const res = await request(app).post('/internal/jobs').set('x-jobs-token', 'errada');
    expect(res.status).toBe(401);
  });

  it('200 com a chave interna', async () => {
    const res = await request(app).post('/internal/jobs').set('x-jobs-token', env.JOBS_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiradas: 0, renovadas: 0, apagadas: 0, falhas: 0, fotosOrfasApagadas: 0, fotosOrfasPendentes: 0 });
  });
});
