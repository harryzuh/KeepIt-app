import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { autorizacao, montarCasa, testarMatrizDePapeis } from '../../test/casa.js';
import { limparBanco } from '../../test/db.js';
import { criarProdutoDeTeste, criarTagDeTeste } from '../../test/produtos.js';

beforeEach(limparBanco);
afterEach(() => {
  delete process.env.TESTAR_RATE_LIMIT;
});
afterAll(() => prisma.$disconnect());

const get = (token?: string) => request(app).get('/tags').set(...autorizacao(token));
const post = (token: string | undefined, corpo?: object) => request(app).post('/tags').set(...autorizacao(token)).send(corpo);

describe('GET /tags', () => {
  it('matriz de papéis: todos da Casa leem; sem token 401', async () => {
    const casa = await montarCasa();
    await testarMatrizDePapeis(casa, (t) => get(t), { semToken: 401, LEITOR: 200, EDITOR: 200, outraCasa: 200, ADMIN: 200 });
  });

  it('lista só as tags da Casa, em ordem alfabética sem diferenciar caixa, com a quantidade de produtos', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ prefixo: 'outra' });
    await criarProdutoDeTeste(casa.casaId, { tags: ['cozinha', 'Banheiro'] });
    await criarProdutoDeTeste(casa.casaId, { tags: ['cozinha'] });
    await criarTagDeTeste(casa.casaId, 'Árvore');
    await criarTagDeTeste(outra.casaId, 'De outra Casa');

    const res = await get(casa.leitor!.token);
    expect(res.status).toBe(200);
    expect(res.body.itens.map((t: { nome: string }) => t.nome)).toEqual(['Árvore', 'Banheiro', 'cozinha']);
    expect(res.body.itens.map((t: { quantidadeProdutos: number }) => t.quantidadeProdutos)).toEqual([0, 1, 2]);
    expect(Object.keys(res.body.itens[0]).sort()).toEqual(['id', 'nome', 'quantidadeProdutos']);
  });

  it('Casa sem tags devolve lista vazia', async () => {
    const casa = await montarCasa();
    expect((await get(casa.admin.token)).body).toEqual({ itens: [] });
  });
});

describe('POST /tags', () => {
  it('matriz de papéis: LEITOR 403; EDITOR e ADMIN criam; ADMIN de outra Casa cria na dele', async () => {
    const casa = await montarCasa();
    await testarMatrizDePapeis(casa, (t, quem) => post(t, { nome: `Tag ${quem}` }), {
      semToken: 401, LEITOR: 403, EDITOR: 201, outraCasa: 201, ADMIN: 201,
    });
  });

  it('cria com trim, guarda o texto digitado e registra TAG_CRIADA', async () => {
    const casa = await montarCasa();
    const res = await post(casa.editor!.token, { nome: '  Garantia  ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(Number), nome: 'Garantia' });
    const tag = await prisma.tag.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(tag.casaId).toBe(casa.casaId);
    const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'TAG_CRIADA' } });
    expect(log).toMatchObject({ usuarioId: casa.editor!.usuario.id, casaId: casa.casaId, entidade: 'Tag', entidadeId: tag.id });
  });

  it('nome repetido sem diferenciar caixa: 409 TAG_EXISTENTE com a existente; sem criar nem auditar', async () => {
    const casa = await montarCasa();
    const existente = await criarTagDeTeste(casa.casaId, 'Cozinha');
    const res = await post(casa.admin.token, { nome: ' cOZINHA ' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'TAG_EXISTENTE', details: { existente: { id: existente.id, nome: 'Cozinha' } } });
    expect(await prisma.tag.count()).toBe(1);
    expect(await prisma.logAuditoria.count({ where: { acao: 'TAG_CRIADA' } })).toBe(0);
  });

  it('o mesmo nome em Casas diferentes é permitido', async () => {
    const a = await montarCasa();
    const b = await montarCasa({ prefixo: 'b' });
    expect((await post(a.admin.token, { nome: 'Sala' })).status).toBe(201);
    expect((await post(b.admin.token, { nome: 'Sala' })).status).toBe(201);
  });

  it('duas criações simultâneas do mesmo nome: uma 201 e a outra 409', async () => {
    const casa = await montarCasa();
    const [r1, r2] = await Promise.all([post(casa.admin.token, { nome: 'Corrida' }), post(casa.editor!.token, { nome: 'corrida' })]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await prisma.tag.count()).toBe(1);
  });

  it.each([
    ['ausente', {}],
    ['vazio', { nome: '   ' }],
    ['longo (41)', { nome: 'a'.repeat(41) }],
    ['com <', { nome: 'a<b' }],
    ['com quebra de linha', { nome: 'a\nb' }],
    ['não texto', { nome: 12 }],
  ])('nome inválido (%s): 422 DADOS_INVALIDOS', async (_n, corpo) => {
    const casa = await montarCasa();
    const res = await post(casa.admin.token, corpo);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: 'DADOS_INVALIDOS', details: [{ campo: 'nome' }] });
  });

  it('aceita 40 caracteres (limite) e ignora campos desconhecidos como casaId', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ prefixo: 'o' });
    const res = await post(casa.admin.token, { nome: 'a'.repeat(40), casaId: outra.casaId });
    expect(res.status).toBe(201);
    expect((await prisma.tag.findUniqueOrThrow({ where: { id: res.body.id } })).casaId).toBe(casa.casaId);
  });

  it('limite de 30 criações por minuto por usuário (429)', async () => {
    process.env.TESTAR_RATE_LIMIT = '1';
    const casa = await montarCasa();
    for (let i = 0; i < 30; i++) expect((await post(casa.admin.token, { nome: `t${i}` })).status).toBe(201);
    const res = await post(casa.admin.token, { nome: 'excedente' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('MUITAS_TENTATIVAS');
  });
});
