import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { autorizacao, montarCasa, testarMatrizDePapeis } from '../../test/casa.js';
import { limparBanco } from '../../test/db.js';
import { criarFotoDeTeste, criarProdutoDeTeste } from '../../test/produtos.js';
import { estatisticasSchema, resumoSchema } from './estatisticas.schema.js';
import { STATEMENT_TIMEOUT_MS, lerEmTransacao } from './estatisticas.service.js';

beforeEach(limparBanco);
afterAll(() => prisma.$disconnect());

const resumo = (token?: string) => request(app).get('/estatisticas/resumo').set(...autorizacao(token));
const completa = (token?: string) => request(app).get('/estatisticas').set(...autorizacao(token));
const dia = (s: string) => new Date(`${s}T00:00:00Z`);

describe('matriz de permissões (RNF31)', () => {
  it.each([
    ['resumo', resumo],
    ['completa', completa],
  ])('%s: sem token 401; todos os papéis e outra Casa 200', async (_n, chamar) => {
    const casa = await montarCasa();
    await testarMatrizDePapeis(casa, (t) => chamar(t), { semToken: 401, LEITOR: 200, EDITOR: 200, outraCasa: 200, ADMIN: 200 });
  });

  it('responde com no-store e ignora query (casaId não existe)', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ prefixo: 'o' });
    await criarProdutoDeTeste(outra.casaId, { preco: '99.00' });
    const res = await request(app).get(`/estatisticas?casaId=${outra.casaId}`).set(...autorizacao(casa.leitor!.token));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.valorTotal).toBe('0.00');
  });
});

describe('Casa vazia', () => {
  it('GET /estatisticas: zeros, nulos e listas vazias, sem NaN', async () => {
    const casa = await montarCasa();
    const res = await completa(casa.leitor!.token);
    expect(res.body).toEqual({
      valorTotal: '0.00', produtos: 0, unidades: 0, valorMedio: '0.00',
      maiorGasto: null, tagMaisComprada: null, valorPorTag: [], totalTagsComProduto: 0, semTag: null, maisAntigos: [],
    });
  });

  it('GET /estatisticas/resumo: Individual, 1 membro e sem renovação', async () => {
    const casa = await montarCasa({ editores: 0, leitores: 0 });
    const res = await resumo(casa.admin.token);
    expect(res.body).toEqual({
      valorTotal: '0.00', produtos: 0, unidades: 0, tags: 0,
      membros: { emUso: 1, limite: 1 },
      armazenamento: { usadoBytes: 0, limiteBytes: 1073741824 },
      plano: { nome: 'INDIVIDUAL' }, renovacao: null,
    });
  });
});

describe('um produto', () => {
  it('preço × quantidade, média igual ao valor, maior gasto e mais antigo são o mesmo produto, sem tag', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId, { nome: 'Geladeira', preco: '2500.50', quantidade: 2, dataCompra: dia('2026-03-15') });
    const res = await completa(casa.admin.token);
    const produto = { id: p.id, nome: 'Geladeira', preco: '2500.50', quantidade: 2, valor: '5001.00', dataCompra: '2026-03-15' };
    expect(estatisticasSchema.parse(res.body)).toEqual({
      valorTotal: '5001.00', produtos: 1, unidades: 2, valorMedio: '5001.00',
      maiorGasto: produto, tagMaisComprada: null, valorPorTag: [], totalTagsComProduto: 0,
      semTag: { valor: '5001.00', unidades: 2, produtos: 1 }, maisAntigos: [produto],
    });
  });
});

describe('vários produtos, tags, empates e sem tag (exemplo do contrato)', () => {
  it('confere cada indicador à mão', async () => {
    const casa = await montarCasa();
    const nb = await criarProdutoDeTeste(casa.casaId, { nome: 'Notebook', preco: '4599.00', quantidade: 1, dataCompra: dia('2026-10-16'), tags: ['Eletrônicos', 'Garantia'] });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Pilhas', preco: '24.90', quantidade: 40, dataCompra: dia('2026-11-05'), tags: ['Utilidades'] });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Caixa', preco: '39.90', quantidade: 4, dataCompra: dia('2026-11-07') });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Cabo', preco: '0.00', quantidade: 3, dataCompra: dia('2026-11-08') });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Cabo 2', preco: '0.00', quantidade: 1, dataCompra: dia('2026-11-09') });
    const res = await completa(casa.editor!.token);
    expect(res.status).toBe(200);
    const b = estatisticasSchema.parse(res.body);
    // 4599 + 996 + 159,60 = 5754,60; 5 produtos; média 1150,92; unidades 1+40+4+3+1 = 49
    expect(b.valorTotal).toBe('5754.60');
    expect(b.produtos).toBe(5);
    expect(b.unidades).toBe(49);
    expect(b.valorMedio).toBe('1150.92');
    expect(b.maiorGasto).toMatchObject({ id: nb.id, valor: '4599.00' });
    expect(b.tagMaisComprada).toEqual({ id: expect.any(Number), nome: 'Utilidades', unidades: 40, produtos: 1 });
    expect(b.valorPorTag.map((t) => [t.nome, t.valor, t.unidades, t.produtos])).toEqual([
      ['Eletrônicos', '4599.00', 1, 1],
      ['Garantia', '4599.00', 1, 1],
      ['Utilidades', '996.00', 40, 1],
    ].sort((a, c) => Number(c[1]) - Number(a[1])));
    expect(b.totalTagsComProduto).toBe(3);
    expect(b.semTag).toEqual({ valor: '159.60', unidades: 8, produtos: 3 });
    expect(b.maisAntigos.map((p) => p.nome)).toEqual(['Notebook', 'Pilhas', 'Caixa', 'Cabo', 'Cabo 2']);
  });

  it('empate no valor por tag: nome A–Z sem diferenciar caixa; Preço 0,00 conta unidades', async () => {
    const casa = await montarCasa();
    await criarProdutoDeTeste(casa.casaId, { preco: '10.00', quantidade: 1, tags: ['zebra', 'Abelha'] });
    const res = await completa(casa.admin.token);
    expect(res.body.valorPorTag.map((t: { nome: string }) => t.nome)).toEqual(['Abelha', 'zebra']);
    // mesmo valor, unidades e produtos: tagMaisComprada desempata pelo nome
    expect(res.body.tagMaisComprada.nome).toBe('Abelha');
  });

  it('tag mais comprada: empate em unidades vence a de mais produtos; depois nome', async () => {
    const casa = await montarCasa();
    await criarProdutoDeTeste(casa.casaId, { preco: '1.00', quantidade: 4, tags: ['A'] });
    await criarProdutoDeTeste(casa.casaId, { preco: '1.00', quantidade: 2, tags: ['B'] });
    await criarProdutoDeTeste(casa.casaId, { preco: '1.00', quantidade: 2, tags: ['B'] });
    // A: 4 un., 1 produto; B: 4 un., 2 produtos -> B
    expect((await completa(casa.admin.token)).body.tagMaisComprada).toMatchObject({ nome: 'B', unidades: 4, produtos: 2 });
  });

  it('produto com várias tags conta inteiro em cada uma; a soma por tag passa do total', async () => {
    const casa = await montarCasa();
    await criarProdutoDeTeste(casa.casaId, { preco: '100.00', quantidade: 2, tags: ['X', 'Y'] });
    const b = (await completa(casa.admin.token)).body;
    expect(b.valorTotal).toBe('200.00');
    expect(b.valorPorTag.map((t: { valor: string }) => t.valor)).toEqual(['200.00', '200.00']);
    expect(b.semTag).toBeNull();
  });

  it('maiorGasto empata pela compra mais recente, depois menor id; mais antigos desempata por cadastro e id; máx. 5', async () => {
    const casa = await montarCasa();
    const a = await criarProdutoDeTeste(casa.casaId, { nome: 'a', preco: '50.00', quantidade: 2, dataCompra: dia('2026-01-01') });
    const b = await criarProdutoDeTeste(casa.casaId, { nome: 'b', preco: '100.00', quantidade: 1, dataCompra: dia('2026-02-01') });
    const c = await criarProdutoDeTeste(casa.casaId, { nome: 'c', preco: '100.00', quantidade: 1, dataCompra: dia('2026-02-01') });
    for (let i = 0; i < 4; i++) await criarProdutoDeTeste(casa.casaId, { nome: `x${i}`, preco: '1.00', dataCompra: dia('2026-03-01') });
    const r = (await completa(casa.admin.token)).body;
    expect(r.maiorGasto.id).toBe(b.id); // a, b, c valem 100; b e c empatam na data com a mais recente; menor id: b
    expect(a.id).toBeLessThan(b.id);
    expect(c.id).toBeGreaterThan(b.id);
    expect(r.maisAntigos).toHaveLength(5);
    expect(r.maisAntigos.slice(0, 3).map((p: { id: number }) => p.id)).toEqual([a.id, b.id, c.id]);
  });

  it('mais de 50 tags: devolve 50 linhas e o total real', async () => {
    const casa = await montarCasa();
    await criarProdutoDeTeste(casa.casaId, { preco: '1.00', tags: Array.from({ length: 53 }, (_, i) => `t${String(i).padStart(2, '0')}`) });
    const b = (await completa(casa.admin.token)).body;
    expect(b.valorPorTag).toHaveLength(50);
    expect(b.totalTagsComProduto).toBe(53);
  });
});

describe('valores grandes (sem perda de precisão)', () => {
  it('preço máximo × quantidade máxima, somado em duas linhas', async () => {
    const casa = await montarCasa();
    await criarProdutoDeTeste(casa.casaId, { preco: '9999999999.99', quantidade: 1_000_000, tags: ['Luxo'] });
    await criarProdutoDeTeste(casa.casaId, { preco: '9999999999.99', quantidade: 1_000_000 });
    const b = estatisticasSchema.parse((await completa(casa.admin.token)).body);
    // 9999999999,99 × 1.000.000 = 9999999999990000,00 (> 2^53 em centavos); dobro = 19999999999980000,00
    expect(b.valorTotal).toBe('19999999999980000.00');
    expect(b.valorMedio).toBe('9999999999990000.00');
    expect(b.maiorGasto?.valor).toBe('9999999999990000.00');
    expect(b.valorPorTag[0].valor).toBe('9999999999990000.00');
    expect(b.unidades).toBe(2_000_000);
    expect((await resumo(casa.admin.token)).body.valorTotal).toBe('19999999999980000.00');
  });

  it('valor médio arredonda meio para cima', async () => {
    const casa = await montarCasa();
    await criarProdutoDeTeste(casa.casaId, { preco: '0.01', quantidade: 1 });
    await criarProdutoDeTeste(casa.casaId, { preco: '0.02', quantidade: 1 });
    // 0,03 / 2 = 0,015 -> 0,02
    expect((await completa(casa.admin.token)).body.valorMedio).toBe('0.02');
  });
});

describe('isolamento entre Casas (RNF27)', () => {
  it('Casas com produtos e tags de mesmo nome não se misturam', async () => {
    const a = await montarCasa();
    const b = await montarCasa({ prefixo: 'b' });
    await criarProdutoDeTeste(a.casaId, { nome: 'TV', preco: '1000.00', quantidade: 1, tags: ['Sala'] });
    await criarProdutoDeTeste(b.casaId, { nome: 'TV', preco: '300.00', quantidade: 5, tags: ['Sala'] });
    await criarProdutoDeTeste(b.casaId, { nome: 'Sem tag B', preco: '7.00', quantidade: 1 });
    const antes = (await completa(a.admin.token)).body;
    expect(antes.valorTotal).toBe('1000.00');
    expect(antes.valorPorTag).toMatchObject([{ nome: 'Sala', valor: '1000.00', unidades: 1, produtos: 1 }]);
    expect(antes.semTag).toBeNull();
    await criarProdutoDeTeste(b.casaId, { nome: 'Outro B', preco: '9999.00', tags: ['Sala'] });
    expect((await completa(a.admin.token)).body).toEqual(antes);
    const rb = (await resumo(b.admin.token)).body;
    expect(rb).toMatchObject({ valorTotal: '11506.00', produtos: 3, unidades: 7, tags: 1 });
  });
});

describe('consistência entre as rotas e com a lista de produtos', () => {
  it('valorTotal e contagens do resumo = da tela 10 = soma dos produtos do banco', async () => {
    const casa = await montarCasa();
    await criarProdutoDeTeste(casa.casaId, { preco: '12.34', quantidade: 3, tags: ['a'] });
    await criarProdutoDeTeste(casa.casaId, { preco: '5.55', quantidade: 7 });
    const [r, c] = [(await resumo(casa.admin.token)).body, (await completa(casa.admin.token)).body];
    expect(r.valorTotal).toBe(c.valorTotal);
    expect([r.produtos, r.unidades]).toEqual([c.produtos, c.unidades]);
    const produtos = await prisma.produto.findMany({ where: { casaId: casa.casaId } });
    const centavos = produtos.reduce((s, p) => s + BigInt(Math.round(Number(p.preco) * 100)) * BigInt(p.quantidade), 0n);
    expect(c.valorTotal).toBe(`${centavos / 100n}.${String(centavos % 100n).padStart(2, '0')}`);
  });
});

describe('GET /estatisticas/resumo (tela 05)', () => {
  it('membros, tags (inclusive sem produto), armazenamento e plano com renovação', async () => {
    const renova = new Date('2027-01-15T17:00:00.000Z');
    const casa = await montarCasa({ assinatura: { plano: 'FAMILIA', dataRenovacao: renova } });
    const p = await criarProdutoDeTeste(casa.casaId, { preco: '20.00', quantidade: 2, tags: ['Uma'] });
    await prisma.tag.create({ data: { casaId: casa.casaId, nome: 'Sem produto' } });
    await criarFotoDeTeste(p.id, { tamanhoBytes: 1234 });
    const res = await resumo(casa.leitor!.token);
    expect(resumoSchema.parse(res.body)).toEqual({
      valorTotal: '40.00', produtos: 1, unidades: 2, tags: 2,
      membros: { emUso: 3, limite: 6 },
      armazenamento: { usadoBytes: 1234, limiteBytes: 21474836480 },
      plano: { nome: 'FAMILIA' },
      renovacao: { status: 'ATIVA', data: renova.toISOString() },
    });
  });

  it('assinatura CANCELADA vigente mostra a data; CANCELADA vencida conta como Individual', async () => {
    const futuro = new Date(Date.now() + 10 * 86_400_000);
    const vigente = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: futuro } });
    expect((await resumo(vigente.admin.token)).body).toMatchObject({
      plano: { nome: 'FAMILIA' }, renovacao: { status: 'CANCELADA', data: futuro.toISOString() },
    });
    const vencida = await montarCasa({ prefixo: 'v', assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: new Date(Date.now() - 86_400_000) } });
    expect((await resumo(vencida.admin.token)).body).toMatchObject({ plano: { nome: 'INDIVIDUAL' }, renovacao: null });
  });

  it('não traz dados de pagamento nem de assinatura além do contrato', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    const res = await resumo(casa.editor!.token);
    expect(Object.keys(res.body).sort()).toEqual(['armazenamento', 'membros', 'plano', 'produtos', 'renovacao', 'tags', 'unidades', 'valorTotal']);
    expect(Object.keys(res.body.renovacao).sort()).toEqual(['data', 'status']);
  });
});

describe('teto de tempo da transação (AppSec F-02)', () => {
  it('aplica statement_timeout local e REPEATABLE READ dentro da transação, sem vazar para a conexão', async () => {
    const dentro = await lerEmTransacao(async (tx) => {
      const [t] = await tx.$queryRaw<{ statement_timeout: string }[]>`SHOW statement_timeout`;
      const [i] = await tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`;
      return { t: t.statement_timeout, i: i.transaction_isolation };
    });
    expect(dentro.t).toBe(`${STATEMENT_TIMEOUT_MS / 1000}s`);
    expect(dentro.i).toBe('repeatable read');
    const [fora] = await prisma.$queryRaw<{ statement_timeout: string }[]>`SHOW statement_timeout`;
    expect(fora.statement_timeout).not.toBe(`${STATEMENT_TIMEOUT_MS / 1000}s`);
  });

  it('consulta lenta (pg_sleep) é cortada pelo statement_timeout e vira 503 ESTATISTICAS_INDISPONIVEL', async () => {
    const inicio = Date.now();
    const erro = (await lerEmTransacao((tx) => tx.$queryRaw`SELECT pg_sleep(5)`, { statementTimeoutMs: 200 }).catch((e: unknown) => e)) as HttpError;
    expect(erro).toBeInstanceOf(HttpError);
    expect(erro).toMatchObject({ status: 503, codigo: 'ESTATISTICAS_INDISPONIVEL' });
    expect(erro.message).not.toMatch(/pg_sleep|SELECT/i);
    expect(Date.now() - inicio).toBeLessThan(3_000);
  });

  it('a conexão volta ao pool após o corte: a rota seguinte responde 200', async () => {
    await lerEmTransacao((tx) => tx.$queryRaw`SELECT pg_sleep(5)`, { statementTimeoutMs: 100 }).catch(() => undefined);
    const casa = await montarCasa();
    expect((await completa(casa.admin.token)).status).toBe(200);
  });

  it('erro que não é de tempo segue como está (não vira 503)', async () => {
    const erro = await lerEmTransacao(async () => {
      throw new Error('falha qualquer');
    }).catch((e) => e);
    expect(erro).not.toBeInstanceOf(HttpError);
  });
});
