import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { adicionarMeses } from '../lib/datas.js';
import { caixaDeSaida } from '../lib/mailer.js';
import { prisma } from '../lib/prisma.js';
import { autorizacao, criarAssinaturaDeTeste, montarCasa } from '../test/casa.js';
import { limparBanco } from '../test/db.js';
import { comNovasTentativas, ehConflitoDeConcorrencia } from '../lib/concorrencia.js';
import { limparFotosOrfas } from './index.js';
import { apagarObjetos, listarObjetos, prefixoRaizDaCasa } from '../lib/s3.js';
import { criarFotoDeTeste, criarProdutoDeTeste, enviarFotoConfirmadaDeTeste, enviarObjetoDeTeste, PNG_1X1 } from '../test/produtos.js';
import { travarCasa } from '../modules/casa/casa.service.js';
import { processarVencimentos } from '../modules/assinatura/vencimento.service.js';

const DIA = 86_400_000;
const vencida = () => new Date(Date.now() - DIA);

beforeEach(async () => {
  await limparBanco();
  caixaDeSaida.length = 0;
});
afterAll(() => prisma.$disconnect());

const job = () => request(app).post('/internal/jobs').set('x-jobs-token', env.JOBS_TOKEN);
const me = (token: string) => request(app).get('/me').set(...autorizacao(token));

async function comMetodo(usuarioId: number, ultimos4: string) {
  await prisma.metodoPagamento.create({ data: { usuarioId, marca: 'VISA', ultimos4 } });
}

describe('POST /internal/jobs · expirarAssinaturas (RF37)', () => {
  it('exige a chave interna e devolve { expiradas, renovadas, apagadas, falhas }', async () => {
    expect((await request(app).post('/internal/jobs')).status).toBe(401);
    const res = await job();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expiradas: 0, renovadas: 0, apagadas: 0, falhas: 0, fotosOrfasApagadas: 0, fotosOrfasPendentes: 0 });
  });

  it('CANCELADA vencida: EXPIRADA, volta ao Individual, desvincula membros extras e mantém produtos', async () => {
    const casa = await montarCasa({
      assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: vencida() },
    });
    const produtoAdmin = await prisma.produto.create({
      data: { casaId: casa.casaId, adicionadoPorId: casa.admin.usuario.id, nome: 'TV', preco: '10.00', dataCompra: new Date('2026-01-01') },
    });
    const produtoEditor = await prisma.produto.create({
      data: { casaId: casa.casaId, adicionadoPorId: casa.editor!.usuario.id, nome: 'Sofá', preco: '10.00', dataCompra: new Date('2026-01-01') },
    });

    const res = await job();
    expect(res.body).toEqual({ expiradas: 1, renovadas: 0, apagadas: 0, falhas: 0, fotosOrfasApagadas: 0, fotosOrfasPendentes: 0 });

    const a = await prisma.assinatura.findFirstOrThrow({ where: { casaId: casa.casaId } });
    expect(a).toMatchObject({ status: 'EXPIRADA', motivoEncerramento: 'CANCELAMENTO' });
    expect(a.encerradaEm).not.toBeNull();

    // o ADMIN fica na Casa, que volta ao Individual
    const perfilAdmin = (await me(casa.admin.token)).body;
    expect(perfilAdmin).toMatchObject({ papel: 'ADMIN', plano: { nome: 'INDIVIDUAL' }, assinatura: null });
    expect(perfilAdmin.casa).toMatchObject({ id: casa.casaId, totalMembros: 1 });

    // cada membro extra ganhou uma Casa própria, como ADMIN
    for (const m of [casa.editor!, casa.leitor!]) {
      const perfil = (await me(m.token)).body;
      expect(perfil.casa.id).not.toBe(casa.casaId);
      expect(perfil).toMatchObject({ papel: 'ADMIN', plano: { nome: 'INDIVIDUAL' }, casa: { totalMembros: 1 } });
    }
    const casaEditor = (await me(casa.editor!.token)).body.casa.id;
    const casaLeitor = (await me(casa.leitor!.token)).body.casa.id;
    expect(casaEditor).not.toBe(casaLeitor);
    expect(await prisma.casa.count()).toBe(3);
    expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(1);

    // produtos permanecem na Casa original; o autor de quem saiu é zerado
    expect(await prisma.produto.count({ where: { casaId: casa.casaId } })).toBe(2);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: produtoAdmin.id } })).adicionadoPorId).toBe(casa.admin.usuario.id);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: produtoEditor.id } })).adicionadoPorId).toBeNull();

    // auditoria
    const exp = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'ASSINATURA_EXPIRADA' } });
    expect(exp).toMatchObject({ casaId: casa.casaId, usuarioId: null, entidadeId: a.id });
    expect(exp.detalhes).toEqual({ motivo: 'CANCELAMENTO', membrosDesvinculados: 2 });
    expect(await prisma.logAuditoria.count({ where: { acao: 'MEMBRO_REMOVIDO' } })).toBe(2);
    expect(await prisma.logAuditoria.count({ where: { acao: 'CASA_CRIADA' } })).toBe(2);

    // e-mails: ao ADMIN e aos membros desvinculados
    const destinos = caixaDeSaida.map((e) => e.para).sort();
    expect(destinos).toEqual(
      [casa.admin.usuario.email, casa.editor!.usuario.email, casa.leitor!.usuario.email].sort(),
    );

    // idempotente
    expect((await job()).body).toEqual({ expiradas: 0, renovadas: 0, apagadas: 0, falhas: 0, fotosOrfasApagadas: 0, fotosOrfasPendentes: 0 });
    expect(await prisma.casa.count()).toBe(3);
  });

  it('Casa só com o ADMIN: expira sem criar Casa nova', async () => {
    const casa = await montarCasa({
      assinatura: { plano: 'BUSINESS', status: 'CANCELADA', dataRenovacao: vencida() },
      editores: 0,
      leitores: 0,
    });
    expect((await job()).body.expiradas).toBe(1);
    expect(await prisma.casa.count()).toBe(1);
    expect((await me(casa.admin.token)).body.plano.nome).toBe('INDIVIDUAL');
  });

  it('ATIVA vencida com cobrança aprovada: renova no mesmo registro, +1 mês, sem mexer nos membros', async () => {
    const antiga = vencida();
    const casa = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'ATIVA', dataRenovacao: antiga } });
    await comMetodo(casa.admin.usuario.id, '4242');
    const antes = (await prisma.assinatura.findFirstOrThrow({ where: { casaId: casa.casaId } }));

    expect((await job()).body).toEqual({ expiradas: 0, renovadas: 1, apagadas: 0, falhas: 0, fotosOrfasApagadas: 0, fotosOrfasPendentes: 0 });

    const depois = await prisma.assinatura.findMany({ where: { casaId: casa.casaId } });
    expect(depois).toHaveLength(1);
    expect(depois[0]).toMatchObject({ id: antes.id, status: 'ATIVA' });
    expect(depois[0]!.dataRenovacao.toISOString()).toBe(adicionarMeses(antiga, 1).toISOString());
    expect(depois[0]!.refPagamento).toMatch(/^sim_/);
    expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(3);
    const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'ASSINATURA_RENOVADA' } });
    expect(log.detalhes).toEqual({ de: antiga.toISOString(), para: adicionarMeses(antiga, 1).toISOString() });
    expect((await me(casa.admin.token)).body.plano.nome).toBe('FAMILIA');
  });

  it('rotina parada por meses: uma única renovação leva a data para o futuro', async () => {
    const antiga = new Date(Date.now() - 75 * DIA);
    const casa = await montarCasa({ assinatura: { plano: 'BUSINESS', status: 'ATIVA', dataRenovacao: antiga } });
    await comMetodo(casa.admin.usuario.id, '4242');
    expect((await job()).body.renovadas).toBe(1);
    const a = await prisma.assinatura.findFirstOrThrow({ where: { casaId: casa.casaId } });
    expect(a.dataRenovacao.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.logAuditoria.count({ where: { acao: 'ASSINATURA_RENOVADA' } })).toBe(1);
  });

  it('ATIVA vencida com cobrança recusada (final 0000): EXPIRADA (RECUSA) e membros desvinculados', async () => {
    const casa = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'ATIVA', dataRenovacao: vencida() } });
    await comMetodo(casa.admin.usuario.id, '0000');
    expect((await job()).body).toEqual({ expiradas: 1, renovadas: 0, apagadas: 0, falhas: 0, fotosOrfasApagadas: 0, fotosOrfasPendentes: 0 });
    const a = await prisma.assinatura.findFirstOrThrow({ where: { casaId: casa.casaId } });
    expect(a).toMatchObject({ status: 'EXPIRADA', motivoEncerramento: 'RECUSA' });
    expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(1);
    expect(await prisma.casa.count()).toBe(3);
    const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'ASSINATURA_EXPIRADA' } });
    expect(log.detalhes).toEqual({ motivo: 'RECUSA', membrosDesvinculados: 2 });
  });

  it('ATIVA vencida sem método de pagamento do titular: EXPIRADA (RECUSA)', async () => {
    const casa = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'ATIVA', dataRenovacao: vencida() } });
    expect((await job()).body.expiradas).toBe(1);
    expect((await prisma.assinatura.findFirstOrThrow({ where: { casaId: casa.casaId } })).motivoEncerramento).toBe('RECUSA');
  });

  it('assinaturas ainda no prazo (ATIVA ou CANCELADA) não são tocadas', async () => {
    const futura = new Date(Date.now() + 3 * DIA);
    const a = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'ATIVA', dataRenovacao: futura } });
    const c = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: futura } });
    expect((await job()).body).toEqual({ expiradas: 0, renovadas: 0, apagadas: 0, falhas: 0, fotosOrfasApagadas: 0, fotosOrfasPendentes: 0 });
    expect((await prisma.assinatura.findFirstOrThrow({ where: { casaId: a.casaId } })).status).toBe('ATIVA');
    expect((await prisma.assinatura.findFirstOrThrow({ where: { casaId: c.casaId } })).status).toBe('CANCELADA');
    expect(await prisma.membro.count({ where: { casaId: c.casaId } })).toBe(3);
  });

  it('assinaturas EXPIRADA e PENDENTE são ignoradas', async () => {
    const casa = await montarCasa();
    await criarAssinaturaDeTeste(casa.casaId, casa.admin.usuario.id, 'FAMILIA', { status: 'EXPIRADA', dataRenovacao: vencida() });
    await criarAssinaturaDeTeste(casa.casaId, casa.admin.usuario.id, 'FAMILIA', { status: 'PENDENTE', dataRenovacao: vencida() });
    expect((await job()).body).toEqual({ expiradas: 0, renovadas: 0, apagadas: 0, falhas: 0, fotosOrfasApagadas: 0, fotosOrfasPendentes: 0 });
  });

  it('execuções concorrentes processam cada assinatura uma só vez', async () => {
    const casa = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: vencida() } });
    const [a, b] = await Promise.all([processarVencimentos(), processarVencimentos()]);
    expect(a.expiradas + b.expiradas).toBe(1);
    expect(await prisma.casa.count()).toBe(3);
    expect(await prisma.logAuditoria.count({ where: { acao: 'ASSINATURA_EXPIRADA' } })).toBe(1);
    expect(await prisma.membro.count({ where: { casaId: casa.casaId } })).toBe(1);
  });

  it('a falha de uma assinatura não impede as demais', async () => {
    const ruim = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: new Date(Date.now() - 2 * DIA) } });
    const boa = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: vencida() }, editores: 0, leitores: 0 });
    // gatilho temporário: falha ao gravar o log de expiração da primeira Casa
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION falha_teste() RETURNS trigger AS $$
      BEGIN
        IF NEW.acao = 'ASSINATURA_EXPIRADA' AND NEW.casa_id = ${ruim.casaId} THEN RAISE EXCEPTION 'falha simulada'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER falha_teste BEFORE INSERT ON log_auditoria FOR EACH ROW EXECUTE FUNCTION falha_teste()`,
    );
    try {
      const silencio = console.error;
      console.error = () => undefined;
      const r = await processarVencimentos().finally(() => {
        console.error = silencio;
      });
      expect(r).toMatchObject({ expiradas: 1, falhas: 1 }); // a falha é contada (alerta no log)
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER falha_teste ON log_auditoria');
      await prisma.$executeRawUnsafe('DROP FUNCTION falha_teste()');
    }
    // a que falhou voltou atrás por inteiro (nada pela metade) e é reprocessada na próxima execução
    expect((await prisma.assinatura.findFirstOrThrow({ where: { casaId: ruim.casaId } })).status).toBe('CANCELADA');
    expect(await prisma.membro.count({ where: { casaId: ruim.casaId } })).toBe(3);
    expect((await prisma.assinatura.findFirstOrThrow({ where: { casaId: boa.casaId } })).status).toBe('EXPIRADA');
    expect((await processarVencimentos()).expiradas).toBe(1);
  });


  it('a rotina roda antes do apagamento de contas e não os mistura', async () => {
    const casa = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: vencida() } });
    await prisma.usuario.update({
      where: { id: casa.leitor!.usuario.id },
      data: { exclusaoSolicitadaEm: new Date(Date.now() - 25 * 3_600_000) },
    });
    const res = await job();
    expect(res.body).toEqual({ expiradas: 1, renovadas: 0, apagadas: 1, falhas: 0, fotosOrfasApagadas: 0, fotosOrfasPendentes: 0 });
    expect(await prisma.usuario.count({ where: { id: casa.leitor!.usuario.id } })).toBe(0);
    expect((await prisma.assinatura.findFirstOrThrow({ where: { casaId: casa.casaId } })).status).toBe('EXPIRADA');
  });

  it('trava a Casa: o job espera uma transação concorrente que já a segura (sem ler membros velhos)', async () => {
    const casa = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: vencida() } });
    let liberar!: () => void;
    const segurando = new Promise<void>((r) => (liberar = r));
    let travou!: () => void;
    const jaTravou = new Promise<void>((r) => (travou = r));
    const outra = prisma.$transaction(async (tx) => {
      await travarCasa(tx, casa.casaId);
      travou();
      await segurando;
    });
    await jaTravou;
    let terminou = false;
    const rotina = processarVencimentos().then((r) => {
      terminou = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(terminou).toBe(false); // bloqueado pela trava da Casa
    expect((await prisma.assinatura.findFirstOrThrow({ where: { casaId: casa.casaId } })).status).toBe('CANCELADA');
    liberar();
    await outra;
    expect(await rotina).toMatchObject({ expiradas: 1, falhas: 0 });
  });
});

describe('conflitos de concorrência (40P01/40001)', () => {
  const erroPrisma = (code: string, meta?: object) => Object.assign(new Error('x'), { name: 'PrismaClientKnownRequestError', code, meta });

  it('reconhece impasse e falha de serialização, e só eles', () => {
    expect(ehConflitoDeConcorrencia(erroPrisma('P2034'))).toBe(true);
    expect(ehConflitoDeConcorrencia(erroPrisma('P2010', { code: '40P01' }))).toBe(true);
    expect(ehConflitoDeConcorrencia(erroPrisma('P2010', { code: '40001' }))).toBe(true);
    expect(ehConflitoDeConcorrencia(new Error('deadlock detected'))).toBe(true);
    expect(ehConflitoDeConcorrencia(erroPrisma('P2002'))).toBe(false);
    expect(ehConflitoDeConcorrencia('texto')).toBe(false);
  });

  it('comNovasTentativas refaz a operação e desiste depois do limite ou de erro diferente', async () => {
    let n = 0;
    expect(await comNovasTentativas(async () => { if (++n < 3) throw erroPrisma('P2034'); return 'ok'; })).toBe('ok');
    expect(n).toBe(3);
    n = 0;
    await expect(comNovasTentativas(async () => { n++; throw erroPrisma('P2034'); })).rejects.toThrow();
    expect(n).toBe(3);
    n = 0;
    await expect(comNovasTentativas(async () => { n++; throw new Error('outro'); })).rejects.toThrow('outro');
    expect(n).toBe(1);
  });

  it('o errorHandler responde 409 CONFLITO_CONCORRENTE (e não 500)', async () => {
    const { errorHandler } = await import('../middlewares/error.js');
    let status = 0;
    let corpo: unknown;
    const res = { headersSent: false, status(c: number) { status = c; return this; }, json(b: unknown) { corpo = b; return this; } };
    errorHandler(erroPrisma('P2010', { code: '40P01' }), {} as never, res as never, (() => undefined) as never);
    expect(status).toBe(409);
    expect(corpo).toMatchObject({ error: 'CONFLITO_CONCORRENTE' });
  });
});

describe('limparFotosOrfas (ADR 0003 · Q4/Q11)', () => {
  const existe = async (casaId: number, chave: string) =>
    (await listarObjetos(prefixoRaizDaCasa(casaId))).objetos.some((o) => o.chave === chave);
  const daqui3h = () => new Date(Date.now() + 3 * 3_600_000);

  it('apaga só objeto sem Foto e com mais de 2 h; preserva recente e Foto gravada; é idempotente', async () => {
    const casa = await montarCasa({});
    const produto = await criarProdutoDeTeste(casa.casaId, { adicionadoPorId: casa.admin.usuario.id });
    const gravada = await enviarFotoConfirmadaDeTeste(casa.casaId, PNG_1X1);
    await criarFotoDeTeste(produto.id, { chave: gravada, tipo: 'PNG' });
    const orfa = await enviarObjetoDeTeste(casa.casaId, PNG_1X1);
    try {
      expect((await limparFotosOrfas()).apagadas).toBe(0);
      expect(await existe(casa.casaId, orfa)).toBe(true);
      expect((await limparFotosOrfas(daqui3h())).apagadas).toBeGreaterThanOrEqual(1);
      expect(await existe(casa.casaId, orfa)).toBe(false);
      expect(await existe(casa.casaId, gravada)).toBe(true);
      expect(await limparFotosOrfas(daqui3h())).toEqual({ apagadas: 0, pendentes: 0 });
    } finally {
      await apagarObjetos([gravada, orfa]);
    }
  });

  it('Casa excluída: os objetos que sobraram são apagados pela conciliação', async () => {
    const casa = await montarCasa({});
    const chave = await enviarObjetoDeTeste(casa.casaId, PNG_1X1);
    await prisma.casa.delete({ where: { id: casa.casaId } });
    try {
      await limparFotosOrfas(daqui3h());
      expect(await existe(casa.casaId, chave)).toBe(false);
    } finally {
      await apagarObjetos([chave]);
    }
  });
});
