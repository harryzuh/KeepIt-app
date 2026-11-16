import type { MarcaCartao } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { adicionarMeses } from '../../lib/datas.js';
import { caixaDeSaida } from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';
import { autorizacao, criarAssinaturaDeTeste, montarCasa, testarMatrizDePapeis } from '../../test/casa.js';
import { limparBanco } from '../../test/db.js';
import { passaNoLuhn } from './assinatura.schema.js';
import { envSchema } from '../../config/env.js';
import { cobrarSimulado, detectarMarca, exigirGatewaySimulado } from './gateway-simulado.js';
import { BYTES_POR_GB } from './plano.service.js';

const DIA = 86_400_000;
const CARTAO_OK = { numero: '4242 4242 4242 4242', validade: '12/40' };
const CARTAO_RECUSADO = { numero: '4111 1100 0005 0000', validade: '12/40' };

beforeEach(async () => {
  await limparBanco();
  caixaDeSaida.length = 0;
});
afterEach(() => {
  delete process.env.TESTAR_RATE_LIMIT;
});
afterAll(() => prisma.$disconnect());

/** Grava um método de pagamento direto no banco (atalho; o PUT tem testes próprios). */
async function comMetodo(usuarioId: number, ultimos4 = '4242', marca: MarcaCartao = 'VISA') {
  await prisma.metodoPagamento.upsert({
    where: { usuarioId },
    create: { usuarioId, marca, ultimos4 },
    update: { marca, ultimos4 },
  });
}

const get = (url: string, token?: string) => request(app).get(url).set(...autorizacao(token));
const post = (url: string, token: string | undefined, corpo?: object) =>
  request(app).post(url).set(...autorizacao(token)).send(corpo);
const put = (url: string, token: string | undefined, corpo?: object) =>
  request(app).put(url).set(...autorizacao(token)).send(corpo);

async function vigentes(casaId: number) {
  return prisma.assinatura.findMany({ where: { casaId, status: { in: ['ATIVA', 'CANCELADA'] } } });
}

describe('utilitários do gateway simulado', () => {
  it('Luhn e marca pelo prefixo; o cartão de recusa é válido no Luhn e termina em 0000', () => {
    expect(passaNoLuhn('4242424242424242')).toBe(true);
    expect(passaNoLuhn('4242424242424241')).toBe(false);
    expect(passaNoLuhn('4111110000050000')).toBe(true);
    expect(detectarMarca('4242424242424242')).toBe('VISA');
    expect(detectarMarca('5555555555554444')).toBe('MASTERCARD');
    expect(detectarMarca('2223003122003222')).toBe('MASTERCARD');
    expect(detectarMarca('378282246310005')).toBe('AMEX');
    expect(detectarMarca('6362970000457013')).toBe('ELO');
    expect(detectarMarca('6011111111111117')).toBe('OUTRA');
  });
});

describe('GET /planos', () => {
  it('matriz de papéis: qualquer papel acessa; sem token 401', async () => {
    const casa = await montarCasa();
    await testarMatrizDePapeis(casa, (t) => get('/planos', t), {
      semToken: 401, LEITOR: 200, EDITOR: 200, ADMIN: 200, outraCasa: 200,
    });
  });

  it('lista os três planos em ordem e marca INDIVIDUAL na Casa sem assinatura', async () => {
    const casa = await montarCasa();
    const res = await get('/planos', casa.leitor!.token);
    expect(res.status).toBe(200);
    expect(res.body.planos.map((p: { nome: string }) => p.nome)).toEqual(['INDIVIDUAL', 'FAMILIA', 'BUSINESS']);
    expect(res.body.planos[1]).toMatchObject({ preco: '19.90', limiteMembros: 6, limiteArmazenamentoGb: 20 });
    expect(res.body.planoAtual).toBe('INDIVIDUAL');
    expect(res.body.assinatura).toBeNull();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('mostra o plano vigente e a assinatura CANCELADA com a data de fim dos benefícios', async () => {
    const renovacao = new Date(Date.now() + 5 * DIA);
    const casa = await montarCasa({ assinatura: { plano: 'BUSINESS', status: 'CANCELADA', dataRenovacao: renovacao } });
    const res = await get('/planos', casa.editor!.token);
    expect(res.body.planoAtual).toBe('BUSINESS');
    expect(res.body.assinatura).toEqual({ status: 'CANCELADA', dataRenovacao: renovacao.toISOString() });
  });

  it('CANCELADA já vencida volta a valer INDIVIDUAL, mesmo antes da rotina rodar', async () => {
    const casa = await montarCasa({
      assinatura: { plano: 'BUSINESS', status: 'CANCELADA', dataRenovacao: new Date(Date.now() - 1000) },
    });
    const res = await get('/planos', casa.admin.token);
    expect(res.body.planoAtual).toBe('INDIVIDUAL');
    expect(res.body.assinatura).toBeNull();
  });
});

describe('GET e PUT /pagamento/metodo', () => {
  it('matriz de papéis (GET e PUT): qualquer papel mexe só no próprio método', async () => {
    const casa = await montarCasa();
    await testarMatrizDePapeis(casa, (t) => get('/pagamento/metodo', t), {
      semToken: 401, LEITOR: 200, EDITOR: 200, ADMIN: 200, outraCasa: 200,
    });
    await testarMatrizDePapeis(casa, (t) => put('/pagamento/metodo', t, CARTAO_OK), {
      semToken: 401, LEITOR: 200, EDITOR: 200, ADMIN: 200, outraCasa: 200,
    });
  });

  it('GET devolve null sem método e o método do próprio usuário depois', async () => {
    const casa = await montarCasa();
    expect((await get('/pagamento/metodo', casa.admin.token)).body).toEqual({ metodo: null });
    await comMetodo(casa.editor!.usuario.id, '1111', 'MASTERCARD');
    const res = await get('/pagamento/metodo', casa.editor!.token);
    expect(res.body.metodo).toMatchObject({ marca: 'MASTERCARD', ultimos4: '1111' });
    // o ADMIN não enxerga o método do EDITOR
    expect((await get('/pagamento/metodo', casa.admin.token)).body).toEqual({ metodo: null });
  });

  it('PUT grava só marca e 4 últimos dígitos, substitui o anterior e audita sem dados do cartão', async () => {
    const casa = await montarCasa();
    const res = await put('/pagamento/metodo', casa.admin.token, CARTAO_OK);
    expect(res.status).toBe(200);
    expect(res.body.metodo).toMatchObject({ marca: 'VISA', ultimos4: '4242' });
    expect(Object.keys(res.body.metodo).sort()).toEqual(['atualizadoEm', 'marca', 'ultimos4']);

    await put('/pagamento/metodo', casa.admin.token, CARTAO_RECUSADO);
    const linhas = await prisma.metodoPagamento.findMany();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ marca: 'VISA', ultimos4: '0000' });

    const logs = await prisma.logAuditoria.findMany({ where: { acao: 'METODO_PAGAMENTO_ALTERADO' } });
    expect(logs).toHaveLength(2);
    const tudo = JSON.stringify(logs, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) + JSON.stringify(linhas);
    expect(tudo).not.toMatch(/4242424242424242|4111110000050000/);
  });

  it('PUT aceita hifens, espaços e CVV ausente', async () => {
    const casa = await montarCasa();
    const res = await put('/pagamento/metodo', casa.admin.token, { numero: '4242-4242-4242-4242', validade: '01/45' });
    expect(res.status).toBe(200);
  });

  it.each([
    ['número com Luhn inválido', { numero: '4242 4242 4242 4241' }, 'numero'],
    ['número curto', { numero: '4242 4242' }, 'numero'],
    ['número com letras', { numero: '4242 4242 4242 42ab' }, 'numero'],
    ['validade vencida', { validade: '01/20' }, 'validade'],
    ['validade com mês inválido', { validade: '13/40' }, 'validade'],
    ['validade fora do formato', { validade: '2040-12' }, 'validade'],
    ['PAN real (Luhn válido, fora da lista de teste)', { numero: '5555 5555 5555 4444' }, 'numero'],
    ['PAN real de outra marca', { numero: '4012 8888 8888 1881' }, 'numero'],
  ])('PUT 422 DADOS_INVALIDOS: %s', async (_nome, alteracao, campo) => {
    const casa = await montarCasa();
    const res = await put('/pagamento/metodo', casa.admin.token, { ...CARTAO_OK, ...alteracao });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('DADOS_INVALIDOS');
    expect(res.body.details.map((d: { campo: string }) => d.campo)).toContain(campo);
    expect(await prisma.metodoPagamento.count()).toBe(0);
  });

  it('PUT não coleta nome nem CVV: os campos são descartados e nunca gravados nem logados', async () => {
    const casa = await montarCasa();
    const res = await put('/pagamento/metodo', casa.admin.token, { ...CARTAO_OK, nome: 'ANA SOUZA SECRETA', cvv: '987' });
    expect(res.status).toBe(200);
    const tudo = JSON.stringify(await prisma.metodoPagamento.findMany()) +
      JSON.stringify(await prisma.logAuditoria.findMany(), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(tudo).not.toMatch(/SECRETA|987/);
  });

  it('gateway barrado: exigirGatewaySimulado(false) responde 503 PAGAMENTO_INDISPONIVEL e o env recusa produção simulada', () => {
    expect(() => exigirGatewaySimulado(true)).not.toThrow();
    expect(() => exigirGatewaySimulado(false)).toThrowError(expect.objectContaining({ status: 503, codigo: 'PAGAMENTO_INDISPONIVEL' }));
    expect(() => cobrarSimulado('4242')).not.toThrow();
    const base = {
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://x:y@localhost:5432/db', JWT_SECRET: 'a'.repeat(40), CODIGO_SECRET: 'b'.repeat(40),
      JOBS_TOKEN: 'c'.repeat(40), S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
    };
    const padrao = envSchema.safeParse(base);
    expect(padrao.success).toBe(false); // PAGAMENTO_SIMULADO ausente = simulado = recusado em produção
    expect(JSON.stringify(padrao.error?.issues)).toContain('PAGAMENTO_SIMULADO');
    expect(envSchema.safeParse({ ...base, PAGAMENTO_SIMULADO: 'true' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, PAGAMENTO_SIMULADO: 'false' }).success).toBe(true);
    expect(envSchema.safeParse({ ...base, NODE_ENV: 'development' }).success).toBe(true);
  });

  it('PUT: o cartão vale até o último dia do mês de validade', async () => {
    const casa = await montarCasa();
    const agora = new Date();
    const mes = String(agora.getUTCMonth() + 1).padStart(2, '0');
    const ano = String(agora.getUTCFullYear() % 100).padStart(2, '0');
    expect((await put('/pagamento/metodo', casa.admin.token, { ...CARTAO_OK, validade: `${mes}/${ano}` })).status).toBe(200);
  });

  it('PUT 429 MUITAS_TENTATIVAS depois de 10 pedidos em 15 min por usuário', async () => {
    process.env.TESTAR_RATE_LIMIT = '1';
    const casa = await montarCasa();
    for (let i = 0; i < 10; i++) {
      expect((await put('/pagamento/metodo', casa.admin.token, { validade: 'x' })).status).toBe(422);
    }
    const bloqueado = await put('/pagamento/metodo', casa.admin.token, CARTAO_OK);
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.error).toBe('MUITAS_TENTATIVAS');
    // outro usuário tem contador próprio
    expect((await put('/pagamento/metodo', casa.editor!.token, CARTAO_OK)).status).toBe(200);
  });
});

describe('POST /assinaturas', () => {
  it('matriz de papéis: todos assinam (o aviso vale só para EDITOR e LEITOR); sem token 401', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ editores: 0, leitores: 0, prefixo: 'outra' });
    for (const m of [...casa.membros, outra.admin]) await comMetodo(m.usuario.id);
    await testarMatrizDePapeis(
      casa,
      (t) => post('/assinaturas', t, { plano: 'FAMILIA', confirmaSaidaDaCasa: true }),
      { semToken: 401, LEITOR: 201, EDITOR: 201, ADMIN: 201, outraCasa: 201 },
      outra,
    );
  });

  describe('ADMIN', () => {
    it('201 assina a Família: assinatura ATIVA, renovação em 1 mês, perfil novo, auditoria e e-mail', async () => {
      const casa = await montarCasa();
      await comMetodo(casa.admin.usuario.id);
      const antes = Date.now();
      const res = await post('/assinaturas', casa.admin.token, { plano: 'FAMILIA' });
      expect(res.status).toBe(201);
      expect(res.body.assinatura).toMatchObject({
        status: 'ATIVA',
        plano: { nome: 'FAMILIA', preco: '19.90', limiteMembros: 6, limiteArmazenamentoGb: 20 },
        dataCancelamento: null,
        renovaAutomaticamente: true,
        podeReativar: false,
      });
      const inicio = new Date(res.body.assinatura.dataInicio);
      expect(inicio.getTime()).toBeGreaterThanOrEqual(antes - 1000);
      expect(res.body.assinatura.dataRenovacao).toBe(adicionarMeses(inicio, 1).toISOString());
      expect(res.body.perfil).toMatchObject({
        papel: 'ADMIN',
        casa: { id: casa.casaId, totalMembros: 3 },
        plano: { nome: 'FAMILIA' },
        assinatura: { status: 'ATIVA', dataRenovacao: res.body.assinatura.dataRenovacao },
      });

      const a = await prisma.assinatura.findFirstOrThrow({ where: { casaId: casa.casaId } });
      expect(a).toMatchObject({ status: 'ATIVA', titularId: casa.admin.usuario.id });
      expect(a.refPagamento).toMatch(/^sim_/);
      const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'ASSINATURA_CRIADA' } });
      expect(log).toMatchObject({ usuarioId: casa.admin.usuario.id, casaId: casa.casaId, entidade: 'Assinatura', entidadeId: a.id });
      expect(log.detalhes).toMatchObject({ plano: 'FAMILIA', comoMembro: false });
      expect(await prisma.logAuditoria.count({ where: { acao: 'PLANO_ALTERADO' } })).toBe(0);
      expect(caixaDeSaida.some((e) => e.para === casa.admin.usuario.email && /confirmada/.test(e.assunto))).toBe(true);
      // plano vigente enxergado por GET /me
      expect((await get('/me', casa.admin.token)).body.plano.nome).toBe('FAMILIA');
    });

    it.each([
      ['plano ausente', {}],
      ['INDIVIDUAL', { plano: 'INDIVIDUAL' }],
      ['plano desconhecido', { plano: 'PREMIUM' }],
      ['confirmaSaidaDaCasa não booleano', { plano: 'FAMILIA', confirmaSaidaDaCasa: 'sim' }],
    ])('422 DADOS_INVALIDOS: %s', async (_nome, corpo) => {
      const casa = await montarCasa();
      await comMetodo(casa.admin.usuario.id);
      const res = await post('/assinaturas', casa.admin.token, corpo);
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('DADOS_INVALIDOS');
      expect(res.body.details.length).toBeGreaterThan(0);
      expect(await prisma.assinatura.count()).toBe(0);
    });

    it('422 METODO_PAGAMENTO_AUSENTE sem método salvo; nada é criado', async () => {
      const casa = await montarCasa();
      const res = await post('/assinaturas', casa.admin.token, { plano: 'FAMILIA' });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('METODO_PAGAMENTO_AUSENTE');
      expect(await prisma.assinatura.count()).toBe(0);
    });

    it('402 PAGAMENTO_RECUSADO (cartão final 0000): nada muda e a recusa é auditada sem cartão', async () => {
      const casa = await montarCasa();
      await put('/pagamento/metodo', casa.admin.token, CARTAO_RECUSADO);
      const res = await post('/assinaturas', casa.admin.token, { plano: 'FAMILIA' });
      expect(res.status).toBe(402);
      expect(res.body.error).toBe('PAGAMENTO_RECUSADO');
      expect(await prisma.assinatura.count()).toBe(0);
      const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'PAGAMENTO_RECUSADO' } });
      expect(log.detalhes).toEqual({ plano: 'FAMILIA' });
      expect(caixaDeSaida.some((e) => /confirmada/.test(e.assunto))).toBe(false);
    });

    it('recusa na troca de plano mantém a assinatura anterior intacta', async () => {
      const casa = await montarCasa({ assinatura: 'FAMILIA' });
      await comMetodo(casa.admin.usuario.id, '0000');
      const res = await post('/assinaturas', casa.admin.token, { plano: 'BUSINESS' });
      expect(res.status).toBe(402);
      const todas = await prisma.assinatura.findMany({ where: { casaId: casa.casaId }, include: { plano: true } });
      expect(todas).toHaveLength(1);
      expect(todas[0]).toMatchObject({ status: 'ATIVA', motivoEncerramento: null });
      expect(todas[0]!.plano.nome).toBe('FAMILIA');
    });

    it('409 ESTADO_INVALIDO ao escolher o plano da assinatura vigente (ATIVA ou CANCELADA vigente)', async () => {
      const ativa = await montarCasa({ assinatura: 'FAMILIA' });
      await comMetodo(ativa.admin.usuario.id);
      const r1 = await post('/assinaturas', ativa.admin.token, { plano: 'FAMILIA' });
      expect(r1.status).toBe(409);
      expect(r1.body.error).toBe('ESTADO_INVALIDO');

      const cancelada = await montarCasa({
        assinatura: { plano: 'BUSINESS', status: 'CANCELADA', dataRenovacao: new Date(Date.now() + 3 * DIA) },
      });
      await comMetodo(cancelada.admin.usuario.id);
      const r2 = await post('/assinaturas', cancelada.admin.token, { plano: 'BUSINESS' });
      expect(r2.status).toBe(409);
      expect(await prisma.assinatura.count()).toBe(2);
    });

    it('troca de plano: a anterior vira EXPIRADA (TROCA), a nova nasce ATIVA e há uma só vigente', async () => {
      const casa = await montarCasa({ assinatura: 'FAMILIA' });
      const anterior = (await vigentes(casa.casaId))[0]!;
      await comMetodo(casa.admin.usuario.id);
      const res = await post('/assinaturas', casa.admin.token, { plano: 'BUSINESS' });
      expect(res.status).toBe(201);
      expect(res.body.perfil.plano.nome).toBe('BUSINESS');
      const velha = await prisma.assinatura.findUniqueOrThrow({ where: { id: anterior.id } });
      expect(velha).toMatchObject({ status: 'EXPIRADA', motivoEncerramento: 'TROCA' });
      expect(velha.encerradaEm).not.toBeNull();
      const vig = await vigentes(casa.casaId);
      expect(vig).toHaveLength(1);
      expect(vig[0]!.id).not.toBe(anterior.id);
      const alterado = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'PLANO_ALTERADO' } });
      expect(alterado.detalhes).toEqual({ de: 'FAMILIA', para: 'BUSINESS' });
      const expirada = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'ASSINATURA_EXPIRADA' } });
      expect(expirada.detalhes).toMatchObject({ motivo: 'TROCA' });
    });

    it('CANCELADA vigente de um plano pode ser trocada por outro; a antiga expira por TROCA', async () => {
      const casa = await montarCasa({
        assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: new Date(Date.now() + 3 * DIA) },
      });
      await comMetodo(casa.admin.usuario.id);
      expect((await post('/assinaturas', casa.admin.token, { plano: 'BUSINESS' })).status).toBe(201);
      expect(await prisma.assinatura.count({ where: { motivoEncerramento: 'TROCA' } })).toBe(1);
    });

    it('CANCELADA já vencida (rotina não rodou) pode assinar o mesmo plano; a antiga expira por CANCELAMENTO', async () => {
      const casa = await montarCasa({
        assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: new Date(Date.now() - 1000) },
      });
      await comMetodo(casa.admin.usuario.id);
      expect((await post('/assinaturas', casa.admin.token, { plano: 'FAMILIA' })).status).toBe(201);
      expect(await prisma.assinatura.count({ where: { motivoEncerramento: 'CANCELAMENTO' } })).toBe(1);
      expect(await prisma.logAuditoria.count({ where: { acao: 'PLANO_ALTERADO' } })).toBe(0);
      expect(await vigentes(casa.casaId)).toHaveLength(1);
    });

    it('422 PLANO_NAO_COMPORTA quando os membros não cabem; no limite exato cabe', async () => {
      const casa = await montarCasa({ editores: 7, leitores: 0 }); // 8 membros
      await comMetodo(casa.admin.usuario.id);
      const res = await post('/assinaturas', casa.admin.token, { plano: 'FAMILIA' });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('PLANO_NAO_COMPORTA');
      expect(res.body.details).toEqual({ plano: 'FAMILIA', violacoes: [{ limite: 'MEMBROS', atual: 8, maximo: 6 }] });
      expect(await prisma.assinatura.count()).toBe(0);
      expect((await post('/assinaturas', casa.admin.token, { plano: 'BUSINESS' })).status).toBe(201);

      const exata = await montarCasa({ editores: 5, leitores: 0 }); // 6 membros
      await comMetodo(exata.admin.usuario.id);
      expect((await post('/assinaturas', exata.admin.token, { plano: 'FAMILIA' })).status).toBe(201);
    });

    it('422 PLANO_NAO_COMPORTA quando o armazenamento em uso não cabe (rebaixar de plano)', async () => {
      const casa = await montarCasa({ assinatura: 'BUSINESS', editores: 0, leitores: 0 });
      await comMetodo(casa.admin.usuario.id);
      const produto = await prisma.produto.create({
        data: { casaId: casa.casaId, nome: 'Item', preco: '1.00', dataCompra: new Date('2026-01-01') },
      });
      const bytes = 2_000_000_000;
      await prisma.foto.createMany({
        data: Array.from({ length: 11 }, (_, i) => ({ produtoId: produto.id, chave: `x${i}`, tipo: 'JPEG' as const, tamanhoBytes: bytes, ordem: i })),
      });
      const res = await post('/assinaturas', casa.admin.token, { plano: 'FAMILIA' });
      expect(res.status).toBe(422);
      expect(res.body.details.violacoes).toEqual([
        { limite: 'ARMAZENAMENTO', atual: 11 * bytes, maximo: 20 * BYTES_POR_GB },
      ]);
      expect((await vigentes(casa.casaId))[0]!.status).toBe('ATIVA');
    });

    it('duplo clique: pedidos simultâneos geram no máximo uma assinatura vigente (o outro recebe 409)', async () => {
      const casa = await montarCasa();
      await comMetodo(casa.admin.usuario.id);
      const [a, b] = await Promise.all([
        post('/assinaturas', casa.admin.token, { plano: 'FAMILIA' }),
        post('/assinaturas', casa.admin.token, { plano: 'FAMILIA' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await vigentes(casa.casaId)).toHaveLength(1);
      expect(await prisma.logAuditoria.count({ where: { acao: 'ASSINATURA_CRIADA' } })).toBe(1);
    });

    it('429 MUITAS_TENTATIVAS depois de 10 pedidos em 15 min por usuário', async () => {
      process.env.TESTAR_RATE_LIMIT = '1';
      const casa = await montarCasa();
      for (let i = 0; i < 10; i++) expect((await post('/assinaturas', casa.admin.token, { plano: 'X' })).status).toBe(422);
      expect((await post('/assinaturas', casa.admin.token, { plano: 'FAMILIA' })).status).toBe(429);
    });
  });

  describe('EDITOR e LEITOR (assinar como membro, RF38)', () => {
    it.each(['editor', 'leitor'] as const)('%s sem confirmaSaidaDaCasa: 422 AVISO_NAO_CONFIRMADO e nada muda', async (quem) => {
      const casa = await montarCasa();
      const m = casa[quem]!;
      await comMetodo(m.usuario.id);
      for (const corpo of [{ plano: 'FAMILIA' }, { plano: 'FAMILIA', confirmaSaidaDaCasa: false }]) {
        const res = await post('/assinaturas', m.token, corpo);
        expect(res.status).toBe(422);
        expect(res.body.error).toBe('AVISO_NAO_CONFIRMADO');
      }
      expect(await prisma.assinatura.count()).toBe(0);
      expect(await prisma.casa.count()).toBe(1);
      expect((await prisma.membro.findUniqueOrThrow({ where: { usuarioId: m.usuario.id } })).casaId).toBe(casa.casaId);
    });

    it.each(['editor', 'leitor'] as const)('%s confirma: sai da Casa, cria Casa nova como ADMIN e assina nela', async (quem) => {
      const casa = await montarCasa({ assinatura: 'FAMILIA' });
      const m = casa[quem]!;
      await comMetodo(m.usuario.id);
      const produto = await prisma.produto.create({
        data: { casaId: casa.casaId, adicionadoPorId: m.usuario.id, nome: 'Item', preco: '10.00', dataCompra: new Date('2026-01-01') },
      });
      const res = await post('/assinaturas', m.token, { plano: 'BUSINESS', confirmaSaidaDaCasa: true });
      expect(res.status).toBe(201);
      const { perfil, assinatura } = res.body;
      expect(perfil.casa.id).not.toBe(casa.casaId);
      expect(perfil).toMatchObject({ papel: 'ADMIN', casa: { totalMembros: 1 }, plano: { nome: 'BUSINESS' } });
      expect(perfil.casa.nome).toMatch(/^Casa de /);
      expect(assinatura.plano.nome).toBe('BUSINESS');

      // saiu da Casa antiga; a Casa antiga, sua assinatura e os demais membros continuam
      const membro = await prisma.membro.findUniqueOrThrow({ where: { usuarioId: m.usuario.id } });
      expect(membro).toMatchObject({ casaId: perfil.casa.id, papel: 'ADMIN' });
      expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(2);
      const antiga = await vigentes(casa.casaId);
      expect(antiga).toHaveLength(1);
      expect(antiga[0]!.status).toBe('ATIVA');
      // a assinatura nova é da Casa nova e o titular é o usuário
      const nova = await vigentes(perfil.casa.id);
      expect(nova).toHaveLength(1);
      expect(nova[0]!.titularId).toBe(m.usuario.id);
      // produtos continuam na Casa antiga, sem autor
      expect(await prisma.produto.findUniqueOrThrow({ where: { id: produto.id } })).toMatchObject({
        casaId: casa.casaId,
        adicionadoPorId: null,
      });
      // auditoria
      for (const acao of ['MEMBRO_SAIU_DA_CASA', 'CASA_CRIADA', 'ASSINATURA_CRIADA']) {
        expect(await prisma.logAuditoria.count({ where: { acao } }), acao).toBe(1);
      }
      // o mesmo token já enxerga a Casa nova (papel e Casa lidos do banco)
      expect((await get('/me', m.token)).body.casa.id).toBe(perfil.casa.id);
      expect((await get('/assinaturas/atual', m.token)).status).toBe(200);
    });

    it('402 PAGAMENTO_RECUSADO: continua na Casa antiga e nenhuma Casa nova é criada', async () => {
      const casa = await montarCasa();
      await comMetodo(casa.editor!.usuario.id, '0000');
      const res = await post('/assinaturas', casa.editor!.token, { plano: 'FAMILIA', confirmaSaidaDaCasa: true });
      expect(res.status).toBe(402);
      expect(await prisma.casa.count()).toBe(1);
      expect(await prisma.assinatura.count()).toBe(0);
      expect((await prisma.membro.findUniqueOrThrow({ where: { usuarioId: casa.editor!.usuario.id } })).casaId).toBe(casa.casaId);
    });

    it('422 METODO_PAGAMENTO_AUSENTE: continua na Casa antiga', async () => {
      const casa = await montarCasa();
      const res = await post('/assinaturas', casa.leitor!.token, { plano: 'FAMILIA', confirmaSaidaDaCasa: true });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('METODO_PAGAMENTO_AUSENTE');
      expect(await prisma.casa.count()).toBe(1);
    });

    it('a Casa antiga lotada não impede: a Casa nova sempre cabe', async () => {
      const casa = await montarCasa({ editores: 9, leitores: 0 }); // 10 membros, Individual
      await comMetodo(casa.editor!.usuario.id);
      const res = await post('/assinaturas', casa.editor!.token, { plano: 'FAMILIA', confirmaSaidaDaCasa: true });
      expect(res.status).toBe(201);
    });

    it('o ADMIN ignora confirmaSaidaDaCasa e continua na própria Casa', async () => {
      const casa = await montarCasa();
      await comMetodo(casa.admin.usuario.id);
      const res = await post('/assinaturas', casa.admin.token, { plano: 'FAMILIA', confirmaSaidaDaCasa: false });
      expect(res.status).toBe(201);
      expect(res.body.perfil.casa.id).toBe(casa.casaId);
    });
  });
});

describe('GET /assinaturas/atual', () => {
  it('matriz de papéis: só ADMIN (EDITOR e LEITOR 403)', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    await testarMatrizDePapeis(casa, (t) => get('/assinaturas/atual', t), {
      semToken: 401, LEITOR: 403, EDITOR: 403, ADMIN: 200, outraCasa: 200,
    });
  });

  it('403 SEM_PERMISSAO traz o código do contrato', async () => {
    const casa = await montarCasa();
    const res = await get('/assinaturas/atual', casa.leitor!.token);
    expect(res.body.error).toBe('SEM_PERMISSAO');
  });

  it('Casa Individual: 200 com assinatura null, plano Individual, uso e método do próprio usuário', async () => {
    const casa = await montarCasa();
    const res = await get('/assinaturas/atual', casa.admin.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      assinatura: null,
      planoAtual: { id: expect.any(Number), nome: 'INDIVIDUAL', preco: '0.00', limiteMembros: 1, limiteArmazenamentoGb: 1 },
      uso: { membros: { emUso: 3, limite: 1 }, armazenamento: { usadoBytes: 0, limiteBytes: BYTES_POR_GB } },
      metodoPagamento: null,
    });
  });

  it('ATIVA: detalhes, uso e método de pagamento', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    await comMetodo(casa.admin.usuario.id);
    const res = await get('/assinaturas/atual', casa.admin.token);
    expect(res.body.assinatura).toMatchObject({
      status: 'ATIVA',
      plano: { nome: 'FAMILIA' },
      dataCancelamento: null,
      renovaAutomaticamente: true,
      podeReativar: false,
    });
    expect(res.body.planoAtual.nome).toBe('FAMILIA');
    expect(res.body.uso.membros).toEqual({ emUso: 3, limite: 6 });
    expect(res.body.uso.armazenamento.limiteBytes).toBe(20 * BYTES_POR_GB);
    expect(res.body.metodoPagamento).toMatchObject({ marca: 'VISA', ultimos4: '4242' });
  });

  it('CANCELADA vigente permite reativar; vencida vale Individual (assinatura null)', async () => {
    const vigente = await montarCasa({
      assinatura: { plano: 'BUSINESS', status: 'CANCELADA', dataRenovacao: new Date(Date.now() + 2 * DIA) },
    });
    const a = (await get('/assinaturas/atual', vigente.admin.token)).body.assinatura;
    expect(a).toMatchObject({ status: 'CANCELADA', renovaAutomaticamente: false, podeReativar: true });
    expect(a.dataCancelamento).not.toBeNull();

    const vencida = await montarCasa({
      assinatura: { plano: 'BUSINESS', status: 'CANCELADA', dataRenovacao: new Date(Date.now() - 1000) },
    });
    const res = await get('/assinaturas/atual', vencida.admin.token);
    expect(res.body.assinatura).toBeNull();
    expect(res.body.planoAtual.nome).toBe('INDIVIDUAL');
  });

  it('não vaza assinatura de outra Casa', async () => {
    await montarCasa({ assinatura: 'BUSINESS' });
    const minha = await montarCasa();
    expect((await get('/assinaturas/atual', minha.admin.token)).body.assinatura).toBeNull();
  });
});

describe('POST /assinaturas/atual/cancelar', () => {
  it('matriz de papéis: só ADMIN', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    const outra = await montarCasa({ assinatura: 'BUSINESS', editores: 0, leitores: 0, prefixo: 'outra' });
    await testarMatrizDePapeis(
      casa,
      (t) => post('/assinaturas/atual/cancelar', t),
      { semToken: 401, LEITOR: 403, EDITOR: 403, ADMIN: 200, outraCasa: 200 },
      outra,
    );
    // cada ADMIN cancelou apenas a própria assinatura
    expect((await vigentes(casa.casaId))[0]!.status).toBe('CANCELADA');
    expect((await vigentes(outra.casaId))[0]!.status).toBe('CANCELADA');
  });

  it('403 não altera a assinatura', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    await post('/assinaturas/atual/cancelar', casa.editor!.token);
    expect((await vigentes(casa.casaId))[0]!.status).toBe('ATIVA');
  });

  it('cancela mantendo o plano até a renovação, audita o motivo e avisa por e-mail', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    const antes = (await vigentes(casa.casaId))[0]!;
    const res = await post('/assinaturas/atual/cancelar', casa.admin.token, { motivo: '  Estou viajando  ' });
    expect(res.status).toBe(200);
    expect(res.body.assinatura).toMatchObject({
      status: 'CANCELADA',
      renovaAutomaticamente: false,
      podeReativar: true,
      dataRenovacao: antes.dataRenovacao.toISOString(),
    });
    expect(res.body.assinatura.dataCancelamento).not.toBeNull();
    // o plano continua o da assinatura até a renovação
    const me = (await get('/me', casa.admin.token)).body;
    expect(me.plano.nome).toBe('FAMILIA');
    expect(me.assinatura.status).toBe('CANCELADA');
    const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'ASSINATURA_CANCELADA' } });
    expect(log).toMatchObject({ usuarioId: casa.admin.usuario.id, casaId: casa.casaId, entidadeId: antes.id });
    expect(log.detalhes).toMatchObject({ motivo: 'Estou viajando' });
    expect(caixaDeSaida.some((e) => e.para === casa.admin.usuario.email && /cancelada/.test(e.assunto))).toBe(true);
  });

  it('motivo vazio vale como ausente', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    const res = await post('/assinaturas/atual/cancelar', casa.admin.token, { motivo: '   ' });
    expect(res.status).toBe(200);
    const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'ASSINATURA_CANCELADA' } });
    expect(log.detalhes).not.toHaveProperty('motivo');
  });

  it.each([
    ['motivo com mais de 300 caracteres', { motivo: 'a'.repeat(301) }],
    ['motivo com marcação', { motivo: '<script>' }],
    ['motivo com caractere bidi (U+202E)', { motivo: 'abc\u202Edef' }],
    ['motivo com espaço de largura zero (U+200B)', { motivo: 'a\u200Bb' }],
    ['motivo que não é texto', { motivo: 5 }],
  ])('422 DADOS_INVALIDOS: %s', async (_nome, corpo) => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    const res = await post('/assinaturas/atual/cancelar', casa.admin.token, corpo);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('DADOS_INVALIDOS');
    expect((await vigentes(casa.casaId))[0]!.status).toBe('ATIVA');
  });

  it('409 ESTADO_INVALIDO: já CANCELADA, Casa Individual, ATIVA vencida e CANCELADA vencida', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    expect((await post('/assinaturas/atual/cancelar', casa.admin.token)).status).toBe(200);
    const dupla = await post('/assinaturas/atual/cancelar', casa.admin.token);
    expect(dupla.status).toBe(409);
    expect(dupla.body.error).toBe('ESTADO_INVALIDO');

    const individual = await montarCasa();
    expect((await post('/assinaturas/atual/cancelar', individual.admin.token)).status).toBe(409);

    const ativaVencida = await montarCasa({
      assinatura: { plano: 'FAMILIA', status: 'ATIVA', dataRenovacao: new Date(Date.now() - 1000) },
    });
    expect((await post('/assinaturas/atual/cancelar', ativaVencida.admin.token)).status).toBe(409);

    const canceladaVencida = await montarCasa({
      assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: new Date(Date.now() - 1000) },
    });
    expect((await post('/assinaturas/atual/cancelar', canceladaVencida.admin.token)).status).toBe(409);
  });

  it('assinatura EXPIRADA não pode ser cancelada', async () => {
    const casa = await montarCasa();
    await criarAssinaturaDeTeste(casa.casaId, casa.admin.usuario.id, 'FAMILIA', { status: 'EXPIRADA' });
    expect((await post('/assinaturas/atual/cancelar', casa.admin.token)).status).toBe(409);
  });

  it('429 MUITAS_TENTATIVAS depois de 10 pedidos em 15 min por usuário', async () => {
    process.env.TESTAR_RATE_LIMIT = '1';
    const casa = await montarCasa();
    for (let i = 0; i < 10; i++) expect((await post('/assinaturas/atual/cancelar', casa.admin.token)).status).toBe(409);
    expect((await post('/assinaturas/atual/cancelar', casa.admin.token)).status).toBe(429);
  });
});

describe('POST /assinaturas/atual/reativar', () => {
  const futura = () => new Date(Date.now() + 5 * DIA);

  it('matriz de papéis: só ADMIN', async () => {
    const casa = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: futura() } });
    const outra = await montarCasa({
      assinatura: { plano: 'BUSINESS', status: 'CANCELADA', dataRenovacao: futura() },
      editores: 0,
      leitores: 0,
      prefixo: 'outra',
    });
    await testarMatrizDePapeis(
      casa,
      (t) => post('/assinaturas/atual/reativar', t),
      { semToken: 401, LEITOR: 403, EDITOR: 403, ADMIN: 200, outraCasa: 200 },
      outra,
    );
    expect((await vigentes(casa.casaId))[0]!.status).toBe('ATIVA');
    expect((await vigentes(outra.casaId))[0]!.status).toBe('ATIVA');
  });

  it('religa a renovação: ATIVA, sem dataCancelamento, com auditoria', async () => {
    const casa = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: futura() } });
    const res = await post('/assinaturas/atual/reativar', casa.admin.token);
    expect(res.status).toBe(200);
    expect(res.body.assinatura).toMatchObject({
      status: 'ATIVA',
      dataCancelamento: null,
      renovaAutomaticamente: true,
      podeReativar: false,
    });
    const a = (await vigentes(casa.casaId))[0]!;
    expect(a).toMatchObject({ status: 'ATIVA', dataCancelamento: null });
    expect(await prisma.logAuditoria.count({ where: { acao: 'ASSINATURA_REATIVADA', entidadeId: a.id } })).toBe(1);
  });

  it('ciclo completo ATIVA → CANCELADA → ATIVA pela API', async () => {
    const casa = await montarCasa({ assinatura: 'BUSINESS' });
    expect((await post('/assinaturas/atual/cancelar', casa.admin.token)).body.assinatura.status).toBe('CANCELADA');
    expect((await post('/assinaturas/atual/reativar', casa.admin.token)).body.assinatura.status).toBe('ATIVA');
    expect((await post('/assinaturas/atual/cancelar', casa.admin.token)).status).toBe(200);
  });

  it('409 ESTADO_INVALIDO: já ATIVA, Casa Individual e CANCELADA com a data de renovação alcançada', async () => {
    const ativa = await montarCasa({ assinatura: 'FAMILIA' });
    const r = await post('/assinaturas/atual/reativar', ativa.admin.token);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('ESTADO_INVALIDO');

    const individual = await montarCasa();
    expect((await post('/assinaturas/atual/reativar', individual.admin.token)).status).toBe(409);

    const vencida = await montarCasa({
      assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: new Date(Date.now() - 1000) },
    });
    expect((await post('/assinaturas/atual/reativar', vencida.admin.token)).status).toBe(409);
    expect((await vigentes(vencida.casaId))[0]!.status).toBe('CANCELADA');
  });

  it('429 MUITAS_TENTATIVAS depois de 10 pedidos em 15 min por usuário', async () => {
    process.env.TESTAR_RATE_LIMIT = '1';
    const casa = await montarCasa();
    for (let i = 0; i < 10; i++) expect((await post('/assinaturas/atual/reativar', casa.admin.token)).status).toBe(409);
    expect((await post('/assinaturas/atual/reativar', casa.admin.token)).status).toBe(429);
  });
});
