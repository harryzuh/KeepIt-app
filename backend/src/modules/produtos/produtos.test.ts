import request from 'supertest';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { chaveFinalDoEnvio, enviarObjeto, obterMetadados } from '../../lib/s3.js';
import { BYTES_POR_GB } from '../assinatura/plano.service.js';
import { autorizacao, montarCasa, testarMatrizDePapeis, type CasaDeTeste } from '../../test/casa.js';
import { limparBanco } from '../../test/db.js';
import {
  PNG_1X1,
  chaveDeTeste,
  criarFotoDeTeste,
  criarProdutoDeTeste,
  criarTagDeTeste,
  enviarObjetoDeTeste,
  gerarImagemDeTeste,
  limparObjetosDeTeste,
} from '../../test/produtos.js';
import { hojeEmSaoPaulo } from './produtos.schema.js';

/** Origem do S3 que o backend usa (s3:9000 no compose, localhost:9000 no CI): é onde a URL assinada é lida. */
const S3_INTERNO = new URL(env.S3_ENDPOINT ?? 'http://s3:9000').origin;

const objetos: string[] = [];
beforeEach(limparBanco);
afterEach(async () => {
  delete process.env.TESTAR_RATE_LIMIT;
  await limparObjetosDeTeste(objetos.splice(0));
});
afterAll(() => prisma.$disconnect());

const get = (url: string, token?: string) => request(app).get(url).set(...autorizacao(token));
const post = (url: string, token: string | undefined, corpo?: object) => request(app).post(url).set(...autorizacao(token)).send(corpo);
const patch = (url: string, token: string | undefined, corpo?: object) => request(app).patch(url).set(...autorizacao(token)).send(corpo);
const del = (url: string, token?: string) => request(app).delete(url).set(...autorizacao(token));

const corpoBase = { nome: 'Cafeteira Elétrica', preco: '249.90', quantidade: 1, dataCompra: '2025-03-15' };
const criar = (token: string | undefined, extra: object = {}) => post('/produtos', token, { ...corpoBase, ...extra });

/** Envia um PNG real ao S3 (área de envio) e devolve a chave PENDENTE; limpa pendente e definitiva ao fim do teste. */
async function foto(casaId: number, corpo: Buffer = PNG_1X1, ext: 'jpg' | 'png' = 'png') {
  const chave = await enviarObjetoDeTeste(casaId, corpo, ext);
  objetos.push(chave, chaveFinalDoEnvio(chave));
  return chave;
}

async function logs(acao: string) {
  return prisma.logAuditoria.findMany({ where: { acao }, orderBy: { id: 'asc' } });
}

// =================================================================================================================
describe('POST /produtos/fotos/upload-url', () => {
  const pedir = (t: string | undefined, corpo: object = { tipo: 'image/png', tamanhoBytes: 1000 }) =>
    post('/produtos/fotos/upload-url', t, corpo);

  it('matriz de papéis: LEITOR 403', async () => {
    const casa = await montarCasa();
    await testarMatrizDePapeis(casa, (t) => pedir(t), { semToken: 401, LEITOR: 403, EDITOR: 200, outraCasa: 200, ADMIN: 200 });
  });

  it('devolve chave com o prefixo da Casa, PUT assinado, cabeçalhos e prazos; sem cache', async () => {
    const casa = await montarCasa();
    const res = await pedir(casa.editor!.token);
    expect(res.status).toBe(200);
    // Chave de ENVIO, em pendentes/: não é a chave servida (AppSec FD1).
    expect(res.body.chave).toMatch(new RegExp(`^casas/${casa.casaId}/pendentes/[0-9a-f-]{36}\\.png$`));
    expect(res.body.metodo).toBe('PUT');
    expect(res.body.cabecalhos).toEqual({ 'Content-Type': 'image/png' });
    expect(res.body.url).toContain(res.body.chave);
    expect(res.body.url).toContain('X-Amz-Signature');
    const dur = new Date(res.body.expiraEm).getTime() - Date.now();
    expect(dur).toBeGreaterThan(4 * 60_000);
    expect(dur).toBeLessThanOrEqual(5 * 60_000);
    expect(new Date(res.body.confirmarAte).getTime() - Date.now()).toBeGreaterThan(110 * 60_000);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('JPEG gera chave .jpg', async () => {
    const casa = await montarCasa();
    const res = await pedir(casa.admin.token, { tipo: 'image/jpeg', tamanhoBytes: 5 * 1024 * 1024 });
    expect(res.status).toBe(200);
    expect(res.body.chave.endsWith('.jpg')).toBe(true);
  });

  it.each([
    ['gif', { tipo: 'image/gif', tamanhoBytes: 100 }],
    ['pdf', { tipo: 'application/pdf', tamanhoBytes: 100 }],
    ['tamanho 0', { tipo: 'image/png', tamanhoBytes: 0 }],
    ['tamanho negativo', { tipo: 'image/png', tamanhoBytes: -5 }],
    ['5 MB + 1 byte', { tipo: 'image/png', tamanhoBytes: 5 * 1024 * 1024 + 1 }],
  ])('%s: 422 ARQUIVO_INVALIDO', async (_n, corpo) => {
    const casa = await montarCasa();
    const res = await pedir(casa.admin.token, corpo);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('ARQUIVO_INVALIDO');
  });

  it.each([
    ['sem tipo', { tamanhoBytes: 10 }],
    ['sem tamanho', { tipo: 'image/png' }],
    ['tamanho texto', { tipo: 'image/png', tamanhoBytes: '10' }],
    ['tamanho fracionado', { tipo: 'image/png', tamanhoBytes: 10.5 }],
  ])('corpo malformado (%s): 422 DADOS_INVALIDOS', async (_n, corpo) => {
    const casa = await montarCasa();
    const res = await pedir(casa.admin.token, corpo);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('DADOS_INVALIDOS');
  });

  it('cota do plano esgotada: 409 COTA_EXCEDIDA com details', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId);
    await criarFotoDeTeste(p.id, { tamanhoBytes: BYTES_POR_GB - 50 });
    const res = await pedir(casa.admin.token, { tipo: 'image/png', tamanhoBytes: 100 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: 'COTA_EXCEDIDA',
      details: { plano: 'INDIVIDUAL', usadoBytes: BYTES_POR_GB - 50, limiteBytes: BYTES_POR_GB },
    });
    expect((await pedir(casa.admin.token, { tipo: 'image/png', tamanhoBytes: 50 })).status).toBe(200);
  });

  it('limite de 30 por minuto por usuário (429)', async () => {
    process.env.TESTAR_RATE_LIMIT = '1';
    const casa = await montarCasa();
    for (let i = 0; i < 30; i++) {
      // Zera o controle de envios pendentes para isolar o limite de requisições por minuto.
      await prisma.logAuditoria.deleteMany({ where: { acao: 'FOTO_ENVIO_EMITIDO', casaId: casa.casaId } });
      expect((await pedir(casa.admin.token)).status).toBe(200);
    }
    await prisma.logAuditoria.deleteMany({ where: { acao: 'FOTO_ENVIO_EMITIDO', casaId: casa.casaId } });
    const res = await pedir(casa.admin.token);
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  describe('teto de envios pendentes (AppSec FD3)', () => {
    it('o 11º envio sem confirmar do mesmo usuário: 429 MUITAS_TENTATIVAS; outro usuário da Casa ainda consegue', async () => {
      const casa = await montarCasa();
      for (let i = 0; i < 10; i++) expect((await pedir(casa.admin.token)).status).toBe(200);
      const res = await pedir(casa.admin.token);
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('MUITAS_TENTATIVAS');
      expect((await pedir(casa.editor!.token)).status).toBe(200);
    });

    it('teto por Casa: 30 pendentes somando os usuários', async () => {
      const casa = await montarCasa();
      const agora = new Date();
      await prisma.logAuditoria.createMany({
        data: Array.from({ length: 30 }, () => ({
          usuarioId: casa.admin.usuario.id,
          casaId: casa.casaId,
          acao: 'FOTO_ENVIO_EMITIDO',
          entidade: 'Foto',
          entidadeId: 0,
          detalhes: { chave: chaveDeTeste(casa.casaId), tamanhoBytes: 10 },
          criadoEm: agora,
        })),
      });
      const res = await pedir(casa.editor!.token);
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('MUITAS_TENTATIVAS');
    });

    it('envios com mais de 2 h deixam de contar; envio confirmado (virou Foto) também', async () => {
      const casa = await montarCasa();
      const velho = new Date(Date.now() - 3 * 3_600_000);
      await prisma.logAuditoria.createMany({
        data: Array.from({ length: 10 }, () => ({
          usuarioId: casa.admin.usuario.id,
          casaId: casa.casaId,
          acao: 'FOTO_ENVIO_EMITIDO',
          entidade: 'Foto',
          entidadeId: 0,
          detalhes: { chave: chaveDeTeste(casa.casaId), tamanhoBytes: 10 },
          criadoEm: velho,
        })),
      });
      expect((await pedir(casa.admin.token)).status).toBe(200);
      // Um envio de verdade, confirmado ao salvar o produto, libera a vaga.
      const envio = (await pedir(casa.editor!.token)).body.chave as string;
      await enviarObjeto(envio, PNG_1X1, 'image/png');
      objetos.push(envio, chaveFinalDoEnvio(envio));
      expect((await criar(casa.editor!.token, { fotos: [{ chave: envio }] })).status).toBe(201);
      const aposConfirmar = await prisma.logAuditoria.count({ where: { acao: 'FOTO_ENVIO_EMITIDO', usuarioId: casa.editor!.usuario.id } });
      expect(aposConfirmar).toBe(1); // o log fica (auditoria), mas não conta como pendente
      for (let i = 0; i < 9; i++) expect((await pedir(casa.editor!.token)).status).toBe(200);
    });

    it('a cota pendente da Casa conta: envios autorizados e não gravados ocupam espaço do plano', async () => {
      const casa = await montarCasa();
      const p = await criarProdutoDeTeste(casa.casaId);
      await criarFotoDeTeste(p.id, { tamanhoBytes: BYTES_POR_GB - 5 * 1024 * 1024 });
      expect((await pedir(casa.admin.token, { tipo: 'image/png', tamanhoBytes: 5 * 1024 * 1024 })).status).toBe(200);
      const res = await pedir(casa.editor!.token, { tipo: 'image/png', tamanhoBytes: 1000 });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('COTA_EXCEDIDA');
    });
  });
});

// =================================================================================================================
describe('POST /produtos · cadastro', () => {
  it('matriz de papéis: LEITOR 403; EDITOR, ADMIN e ADMIN de outra Casa criam na Casa deles', async () => {
    const casa = await montarCasa();
    await testarMatrizDePapeis(casa, (t, quem) => criar(t, { nome: `Item ${quem}` }), {
      semToken: 401, LEITOR: 403, EDITOR: 201, outraCasa: 201, ADMIN: 201,
    });
  });

  it('cria com todos os campos: 201 CRIADO, ProdutoDetalhe, autor do token, Casa do token e auditoria', async () => {
    const casa = await montarCasa();
    const t1 = await criarTagDeTeste(casa.casaId, 'Cozinha');
    const t2 = await criarTagDeTeste(casa.casaId, 'azul');
    const res = await criar(casa.editor!.token, { descricao: '  Preta, 15 xícaras  ', tagIds: [t1.id, t2.id] });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.resultado).toBe('CRIADO');
    expect(res.body.produto).toEqual({
      id: expect.any(Number),
      nome: 'Cafeteira Elétrica',
      descricao: 'Preta, 15 xícaras',
      preco: '249.90',
      quantidade: 1,
      dataCompra: '2025-03-15',
      dataCadastro: expect.any(String),
      atualizadoEm: expect.any(String),
      tags: [{ id: t2.id, nome: 'azul' }, { id: t1.id, nome: 'Cozinha' }],
      fotos: [],
      adicionadoPor: { id: casa.editor!.usuario.id, nome: casa.editor!.usuario.nome },
    });
    const gravado = await prisma.produto.findUniqueOrThrow({ where: { id: res.body.produto.id } });
    expect(gravado.casaId).toBe(casa.casaId);
    const [log] = await logs('PRODUTO_CRIADO');
    expect(log).toMatchObject({ usuarioId: casa.editor!.usuario.id, casaId: casa.casaId, entidade: 'Produto', entidadeId: gravado.id });
    expect(log!.detalhes).toEqual({ nome: 'Cafeteira Elétrica', preco: '249.90', quantidade: 1, tags: ['azul', 'Cozinha'], fotos: 0 });
  });

  it('preço string normaliza para 2 casas e o corpo ignora casaId/adicionadoPorId', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ prefixo: 'o' });
    const res = await criar(casa.admin.token, {
      preco: '10.5', casaId: outra.casaId, adicionadoPorId: outra.admin.usuario.id, dataCadastro: '2000-01-01T00:00:00Z',
    });
    expect(res.status).toBe(201);
    expect(res.body.produto.preco).toBe('10.50');
    expect(res.body.produto.adicionadoPor.id).toBe(casa.admin.usuario.id);
    expect(res.body.produto.dataCadastro.startsWith('2000')).toBe(false);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: res.body.produto.id } })).casaId).toBe(casa.casaId);
  });

  it('limites válidos: preço 0 e máximo, quantidade 1 e 1.000.000, nome 120, descrição 1000, 10 tags, hoje', async () => {
    const casa = await montarCasa();
    const tags = await Promise.all(Array.from({ length: 10 }, (_, i) => criarTagDeTeste(casa.casaId, `t${i}`)));
    const casos = [
      { nome: 'a'.repeat(120), preco: '0', quantidade: 1, dataCompra: hojeEmSaoPaulo() },
      { nome: 'b', preco: '9999999999.99', quantidade: 1_000_000, descricao: 'x'.repeat(1000), tagIds: tags.map((t) => t.id) },
      { nome: 'c', preco: '5', descricao: 'linha 1\nlinha 2' },
    ];
    for (const c of casos) expect((await criar(casa.admin.token, c)).status, JSON.stringify(c).slice(0, 60)).toBe(201);
  });

  it('descrição vazia vira null', async () => {
    const casa = await montarCasa();
    const res = await criar(casa.admin.token, { descricao: '   ' });
    expect(res.body.produto.descricao).toBeNull();
  });

  const invalidos: [string, object, string][] = [
    ['nome ausente', { nome: undefined }, 'nome'],
    ['nome vazio', { nome: '  ' }, 'nome'],
    ['nome com 121', { nome: 'a'.repeat(121) }, 'nome'],
    ['nome com <', { nome: 'a<b>' }, 'nome'],
    ['nome com controle', { nome: 'a\u0000b' }, 'nome'],
    ['descrição com 1001', { descricao: 'x'.repeat(1001) }, 'descricao'],
    ['descrição com <', { descricao: '<script>' }, 'descricao'],
    ['preço ausente', { preco: undefined }, 'preco'],
    ['preço negativo', { preco: '-1' }, 'preco'],
    ['preço com vírgula', { preco: '1,50' }, 'preco'],
    ['preço com 3 casas', { preco: '1.505' }, 'preco'],
    ['preço número JSON (1.5)', { preco: 1.5 }, 'preco'],
    ['preço número JSON inteiro', { preco: 10 }, 'preco'],
    ['nome com U+202E (inversão de direção)', { nome: 'abc\u202Edef' }, 'nome'],
    ['nome com U+200B (largura zero)', { nome: 'Cafe\u200Bteira' }, 'nome'],
    ['descrição com U+202E', { descricao: 'texto\u202Ex' }, 'descricao'],
    ['data 0001-01-01', { dataCompra: '0001-01-01' }, 'dataCompra'],
    ['data 1899-12-31', { dataCompra: '1899-12-31' }, 'dataCompra'],
    ['preço acima do máximo', { preco: '10000000000.00' }, 'preco'],
    ['preço texto', { preco: 'abc' }, 'preco'],
    ['quantidade 0', { quantidade: 0 }, 'quantidade'],
    ['quantidade fracionada', { quantidade: 1.5 }, 'quantidade'],
    ['quantidade acima do máximo', { quantidade: 1_000_001 }, 'quantidade'],
    ['quantidade texto', { quantidade: '2' }, 'quantidade'],
    ['data ausente', { dataCompra: undefined }, 'dataCompra'],
    ['data em outro formato', { dataCompra: '15/03/2025' }, 'dataCompra'],
    ['data inexistente', { dataCompra: '2025-02-30' }, 'dataCompra'],
    ['data futura', { dataCompra: '2999-01-01' }, 'dataCompra'],
    ['tagIds não é lista', { tagIds: 3 }, 'tagIds'],
    ['tagIds repetidos', { tagIds: [1, 1] }, 'tagIds'],
    ['11 tags', { tagIds: Array.from({ length: 11 }, (_, i) => i + 1) }, 'tagIds'],
    ['duplicado inválido', { duplicado: 'TALVEZ' }, 'duplicado'],
    ['duplicado CANCELAR não é aceito', { duplicado: 'CANCELAR' }, 'duplicado'],
    ['SOMAR sem duplicadoId', { duplicado: 'SOMAR' }, 'duplicadoId'],
    ['fotos repetidas', { fotos: [{ chave: 'a' }, { chave: 'a' }] }, 'fotos'],
  ];
  it.each(invalidos)('%s: 422 DADOS_INVALIDOS', async (_n, extra, campo) => {
    const casa = await montarCasa();
    const res = await criar(casa.admin.token, extra);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('DADOS_INVALIDOS');
    expect(res.body.details.map((d: { campo: string }) => d.campo.split('.')[0])).toContain(campo);
    expect(await prisma.produto.count()).toBe(0);
  });

  it('tag de outra Casa ou inexistente: 422 sem revelar (tagIds.N)', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ prefixo: 'o' });
    const alheia = await criarTagDeTeste(outra.casaId, 'Alheia');
    const propria = await criarTagDeTeste(casa.casaId, 'Minha');
    for (const ids of [[alheia.id], [propria.id, 999999]]) {
      const res = await criar(casa.admin.token, { tagIds: ids });
      expect(res.status).toBe(422);
      expect(res.body.details[0].campo).toBe(`tagIds.${ids.length - 1}`);
    }
    expect(await prisma.produto.count()).toBe(0);
  });

  it('corpo vazio: 422 com os campos obrigatórios', async () => {
    const casa = await montarCasa();
    const res = await post('/produtos', casa.admin.token, {});
    expect(res.status).toBe(422);
    expect(res.body.details.map((d: { campo: string }) => d.campo).sort()).toEqual(['dataCompra', 'nome', 'preco', 'quantidade']);
  });

  it('limite de 60 por minuto por usuário (429)', async () => {
    process.env.TESTAR_RATE_LIMIT = '1';
    const casa = await montarCasa();
    for (let i = 0; i < 60; i++) expect((await criar(casa.admin.token, { nome: `p${i}` })).status).toBe(201);
    expect((await criar(casa.admin.token, { nome: 'excedente' })).status).toBe(429);
  }, 60_000);

  // ------------------------------------------------------------ duplicidade (RF33)
  describe('duplicidade', () => {
    it('nome igual sem diferenciar caixa e com trim: 409 PRODUTO_DUPLICADO com o existente e as opções; nada gravado', async () => {
      const casa = await montarCasa();
      const existente = await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira elétrica', preco: '199.00', quantidade: 2, dataCompra: new Date('2025-10-02') });
      const res = await criar(casa.editor!.token, { nome: '  CAFETEIRA ELÉTRICA ', quantidade: 3 });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: 'PRODUTO_DUPLICADO',
        message: expect.any(String),
        details: {
          existente: { id: existente.id, nome: 'Cafeteira elétrica', preco: '199.00', quantidade: 2, dataCompra: '2025-10-02', fotoCapaId: null },
          quantidadeInformada: 3,
          opcoes: ['SOMAR', 'CADASTRAR_MESMO_ASSIM', 'CANCELAR'],
        },
      });
      expect(await prisma.produto.count()).toBe(1);
      expect(await logs('PRODUTO_CRIADO')).toHaveLength(0);
    });

    it('o existente traz só o id da capa: NENHUMA URL assinada vai no details do erro (AppSec FD6)', async () => {
      const casa = await montarCasa();
      const existente = await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira Elétrica' });
      const f = await criarFotoDeTeste(existente.id, { chave: await foto(casa.casaId) });
      const res = await criar(casa.admin.token);
      expect(res.status).toBe(409);
      expect(res.body.details.existente.fotoCapaId).toBe(f.id);
      expect(res.body.details.existente.fotoCapa).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/X-Amz-Signature|https?:\/\//);
    });

    it('acento diferente NÃO é duplicado (sem normalizar acentos)', async () => {
      const casa = await montarCasa();
      await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira Eletrica' });
      expect((await criar(casa.admin.token)).status).toBe(201);
    });

    it('produto de outra Casa com o mesmo nome não conta', async () => {
      const casa = await montarCasa();
      const outra = await montarCasa({ prefixo: 'o' });
      await criarProdutoDeTeste(outra.casaId, { nome: 'Cafeteira Elétrica' });
      expect((await criar(casa.admin.token)).status).toBe(201);
    });

    it('curingas do LIKE no nome não casam por engano ("100%" não duplica "1000")', async () => {
      const casa = await montarCasa();
      await criarProdutoDeTeste(casa.casaId, { nome: '1000' });
      expect((await criar(casa.admin.token, { nome: '100%' })).status).toBe(201);
    });

    it('CADASTRAR_MESMO_ASSIM cria outro produto; com vários duplicados o 409 traz o mais antigo', async () => {
      const casa = await montarCasa();
      const primeiro = await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira Elétrica' });
      const res = await criar(casa.admin.token, { duplicado: 'CADASTRAR_MESMO_ASSIM' });
      expect(res.status).toBe(201);
      expect(res.body.resultado).toBe('CRIADO');
      expect(await prisma.produto.count()).toBe(2);
      const novo = await criar(casa.admin.token);
      expect(novo.status).toBe(409);
      expect(novo.body.details.existente.id).toBe(primeiro.id);
    });

    it('SOMAR soma só a quantidade: 200 QUANTIDADE_SOMADA com o existente; demais dados e tags intactos; evento próprio', async () => {
      const casa = await montarCasa();
      const existente = await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira Elétrica', preco: '199.00', quantidade: 2, descricao: 'original', tags: ['Cozinha'] });
      const outraTag = await criarTagDeTeste(casa.casaId, 'Outra');
      const res = await criar(casa.editor!.token, {
        quantidade: 3, preco: '1.00', descricao: 'nova', tagIds: [outraTag.id], duplicado: 'SOMAR', duplicadoId: existente.id,
      });
      expect(res.status).toBe(200);
      expect(res.body.resultado).toBe('QUANTIDADE_SOMADA');
      expect(res.body.produto).toMatchObject({ id: existente.id, quantidade: 5, preco: '199.00', descricao: 'original', tags: [{ nome: 'Cozinha' }] });
      expect(await prisma.produto.count()).toBe(1);
      expect(await logs('PRODUTO_CRIADO')).toHaveLength(0);
      const [log] = await logs('PRODUTO_QUANTIDADE_SOMADA');
      expect(log).toMatchObject({ usuarioId: casa.editor!.usuario.id, entidadeId: existente.id, detalhes: { anterior: 2, somada: 3, final: 5 } });
    });

    it('SOMAR descarta as fotos informadas e apaga os objetos do S3', async () => {
      const casa = await montarCasa();
      const existente = await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira Elétrica' });
      const chave = await foto(casa.casaId);
      const res = await criar(casa.admin.token, { fotos: [{ chave }], duplicado: 'SOMAR', duplicadoId: existente.id });
      expect(res.status).toBe(200);
      expect(res.body.produto.fotos).toEqual([]);
      expect(await obterMetadados(chave)).toBeNull();
      expect(await prisma.foto.count()).toBe(0);
    });

    it('SOMAR com duplicadoId diferente do duplicado atual: 409 PRODUTO_DUPLICADO de novo, sem somar', async () => {
      const casa = await montarCasa();
      const existente = await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira Elétrica', quantidade: 2 });
      const outro = await criarProdutoDeTeste(casa.casaId, { nome: 'Outro' });
      const res = await criar(casa.admin.token, { duplicado: 'SOMAR', duplicadoId: outro.id });
      expect(res.status).toBe(409);
      expect(res.body.details.existente.id).toBe(existente.id);
      expect((await prisma.produto.findUniqueOrThrow({ where: { id: existente.id } })).quantidade).toBe(2);
    });

    it('SOMAR com o duplicado sumido (excluído): 201 CRIADO como novo', async () => {
      const casa = await montarCasa();
      const res = await criar(casa.admin.token, { duplicado: 'SOMAR', duplicadoId: 987654 });
      expect(res.status).toBe(201);
      expect(res.body.resultado).toBe('CRIADO');
    });

    it('SOMAR cuja soma passa de 1.000.000: 422 em quantidade e nada muda', async () => {
      const casa = await montarCasa();
      const existente = await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira Elétrica', quantidade: 999_999 });
      const res = await criar(casa.admin.token, { quantidade: 2, duplicado: 'SOMAR', duplicadoId: existente.id });
      expect(res.status).toBe(422);
      expect(res.body.details[0].campo).toBe('quantidade');
      expect((await prisma.produto.findUniqueOrThrow({ where: { id: existente.id } })).quantidade).toBe(999_999);
      expect(await logs('PRODUTO_QUANTIDADE_SOMADA')).toHaveLength(0);
    });

    it('somas simultâneas não perdem quantidade (atômico)', async () => {
      const casa = await montarCasa();
      const existente = await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira Elétrica', quantidade: 1 });
      const rs = await Promise.all(
        Array.from({ length: 5 }, () => criar(casa.admin.token, { quantidade: 2, duplicado: 'SOMAR', duplicadoId: existente.id })),
      );
      expect(rs.every((r) => r.status === 200)).toBe(true);
      expect((await prisma.produto.findUniqueOrThrow({ where: { id: existente.id } })).quantidade).toBe(11);
    });

    it('LEITOR não soma (403) e duplicado fica ignorado quando não há duplicidade', async () => {
      const casa = await montarCasa();
      expect((await criar(casa.leitor!.token, { duplicado: 'SOMAR', duplicadoId: 1 })).status).toBe(403);
      const res = await criar(casa.admin.token, { duplicado: 'CADASTRAR_MESMO_ASSIM' });
      expect(res.status).toBe(201);
    });
  });

  // ------------------------------------------------------------ fotos
  describe('fotos', () => {
    it('confere o tipo REAL: PNG e JPEG gravados com tipo, tamanho e ordem; auditoria conta as fotos', async () => {
      const casa = await montarCasa();
      const c1 = await foto(casa.casaId, PNG_1X1, 'png');
      const jpeg = await gerarImagemDeTeste('JPEG', 16, 12);
      const c2 = await foto(casa.casaId, jpeg, 'jpg');
      const res = await criar(casa.editor!.token, { fotos: [{ chave: c2 }, { chave: c1 }] });
      expect(res.status).toBe(201);
      expect(res.body.produto.fotos).toEqual([
        { id: expect.any(Number), ordem: 0, tipo: 'JPEG', tamanhoBytes: expect.any(Number), url: expect.stringContaining(chaveFinalDoEnvio(c2)), expiraEm: expect.any(String) },
        { id: expect.any(Number), ordem: 1, tipo: 'PNG', tamanhoBytes: expect.any(Number), url: expect.stringContaining(chaveFinalDoEnvio(c1)), expiraEm: expect.any(String) },
      ]);
      // O tamanho gravado é o do objeto recodificado que está no S3 (e é o que conta na cota).
      for (const f of res.body.produto.fotos as { tamanhoBytes: number }[]) expect(f.tamanhoBytes).toBeGreaterThan(0);
      expect((await obterMetadados(chaveFinalDoEnvio(c1)))?.tamanhoBytes).toBe(res.body.produto.fotos[1].tamanhoBytes);
      // O objeto de envio é apagado ao salvar.
      expect(await obterMetadados(c1)).toBeNull();
      expect(await obterMetadados(c2)).toBeNull();
      const [log] = await logs('PRODUTO_CRIADO');
      expect(log!.detalhes).toMatchObject({ fotos: 2 });
      // A URL de leitura realmente serve o arquivo.
      const baixou = await fetch(res.body.produto.fotos[1].url.replace(/^https?:\/\/[^/]+/, S3_INTERNO));
      expect(baixou.status).toBe(200);
    });

    it('arquivo com extensão .png mas conteúdo que não é imagem: 422 ARQUIVO_INVALIDO e o objeto é apagado', async () => {
      const casa = await montarCasa();
      const chave = await foto(casa.casaId, Buffer.from('MZ\x90\x00 isto é um executável renomeado'), 'png');
      const res = await criar(casa.admin.token, { fotos: [{ chave }] });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ error: 'ARQUIVO_INVALIDO', details: [{ campo: 'fotos.0' }] });
      expect(await obterMetadados(chave)).toBeNull();
      expect(await prisma.produto.count()).toBe(0);
    });

    it('GIF disfarçado de JPEG (conteúdo GIF): 422', async () => {
      const casa = await montarCasa();
      const chave = await foto(casa.casaId, Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;'), 'jpg');
      const res = await criar(casa.admin.token, { fotos: [{ chave }] });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('ARQUIVO_INVALIDO');
    });

    it('objeto maior que 5 MB: 422 e apagado; exatamente 5 MB: aceito', async () => {
      const casa = await montarCasa();
      const cinco = 5 * 1024 * 1024;
      const grande = Buffer.concat([PNG_1X1, Buffer.alloc(cinco + 1 - PNG_1X1.length)]);
      const limite = Buffer.concat([PNG_1X1, Buffer.alloc(cinco - PNG_1X1.length)]);
      const cGrande = await foto(casa.casaId, grande);
      const cLimite = await foto(casa.casaId, limite);
      const r1 = await criar(casa.admin.token, { fotos: [{ chave: cGrande }] });
      expect(r1.status).toBe(422);
      expect(r1.body.error).toBe('ARQUIVO_INVALIDO');
      expect(await obterMetadados(cGrande)).toBeNull();
      const r2 = await criar(casa.admin.token, { fotos: [{ chave: cLimite }] });
      expect(r2.status).toBe(201);
      // Imagem recodificada: os bytes soltos depois do PNG não sobrevivem (o objeto de 5 MB vira poucos bytes).
      expect(r2.body.produto.fotos[0].tamanhoBytes).toBeLessThan(1000);
    });

    it('objeto de 0 byte: 422', async () => {
      const casa = await montarCasa();
      const chave = await foto(casa.casaId, Buffer.alloc(0));
      expect((await criar(casa.admin.token, { fotos: [{ chave }] })).status).toBe(422);
    });

    it('chave de outra Casa, fora do formato ou inexistente: 422 e o objeto alheio NÃO é apagado', async () => {
      const casa = await montarCasa();
      const outra = await montarCasa({ prefixo: 'o' });
      const alheia = await foto(outra.casaId);
      for (const chave of [alheia, '../../etc/passwd', chaveDeTeste(casa.casaId)]) {
        const res = await criar(casa.admin.token, { fotos: [{ chave }] });
        expect(res.status, chave).toBe(422);
        expect(res.body.error).toBe('ARQUIVO_INVALIDO');
      }
      expect(await obterMetadados(alheia)).not.toBeNull();
    });

    it('chave já usada por outra foto: 422 e o objeto continua', async () => {
      const casa = await montarCasa();
      const chave = await foto(casa.casaId);
      const p = await criarProdutoDeTeste(casa.casaId);
      await criarFotoDeTeste(p.id, { chave: chaveFinalDoEnvio(chave) });
      const res = await criar(casa.admin.token, { fotos: [{ chave }] });
      expect(res.status).toBe(422);
      expect(await obterMetadados(chave)).not.toBeNull();
    });

    it('4 fotos: 422 LIMITE_FOTOS; 3 fotos: 201', async () => {
      const casa = await montarCasa();
      const chaves = await Promise.all([1, 2, 3, 4].map(() => foto(casa.casaId)));
      const r4 = await criar(casa.admin.token, { fotos: chaves.map((chave) => ({ chave })) });
      expect(r4.status).toBe(422);
      expect(r4.body.error).toBe('LIMITE_FOTOS');
      const r3 = await criar(casa.admin.token, { fotos: chaves.slice(0, 3).map((chave) => ({ chave })) });
      expect(r3.status).toBe(201);
      expect(r3.body.produto.fotos).toHaveLength(3);
    });

    it('cota esgotada: 409 COTA_EXCEDIDA, nada gravado e o objeto válido é mantido', async () => {
      const casa = await montarCasa();
      const p = await criarProdutoDeTeste(casa.casaId, { nome: 'Cheio' });
      await criarFotoDeTeste(p.id, { tamanhoBytes: BYTES_POR_GB - 10 });
      const chave = await foto(casa.casaId);
      const res = await criar(casa.admin.token, { fotos: [{ chave }] });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'COTA_EXCEDIDA', details: { plano: 'INDIVIDUAL', limiteBytes: BYTES_POR_GB } });
      expect(await prisma.produto.count()).toBe(1);
      expect(await obterMetadados(chave)).not.toBeNull();
    });

    it('plano maior comporta o que o Individual não comporta', async () => {
      const casa = await montarCasa({ assinatura: 'FAMILIA' });
      const p = await criarProdutoDeTeste(casa.casaId, { nome: 'Cheio' });
      await criarFotoDeTeste(p.id, { tamanhoBytes: BYTES_POR_GB });
      expect((await criar(casa.admin.token, { fotos: [{ chave: await foto(casa.casaId) }] })).status).toBe(201);
    });

    it('duplicidade vem ANTES das fotos: 409 PRODUTO_DUPLICADO e as fotos enviadas continuam no S3', async () => {
      const casa = await montarCasa();
      await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira Elétrica' });
      const chave = await foto(casa.casaId);
      const res = await criar(casa.admin.token, { fotos: [{ chave }] });
      expect(res.status).toBe(409);
      expect(await obterMetadados(chave)).not.toBeNull();
      // Reenvio com a mesma foto e a escolha do usuário.
      const ok = await criar(casa.admin.token, { fotos: [{ chave }], duplicado: 'CADASTRAR_MESMO_ASSIM' });
      expect(ok.status).toBe(201);
      expect(ok.body.produto.fotos).toHaveLength(1);
    });
  });
});

// =================================================================================================================
describe('GET /produtos · listar, buscar e filtrar', () => {
  it('matriz de papéis: todos da Casa leem; ADMIN de outra Casa lê a dele (lista vazia)', async () => {
    const casa = await montarCasa();
    await criarProdutoDeTeste(casa.casaId);
    await testarMatrizDePapeis(casa, (t) => get('/produtos', t), { semToken: 401, LEITOR: 200, EDITOR: 200, outraCasa: 200, ADMIN: 200 });
  });

  it('devolve ProdutoResumo paginado só da Casa do token; recentes primeiro; sem cache', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ prefixo: 'o' });
    const p1 = await criarProdutoDeTeste(casa.casaId, { nome: 'Primeiro', adicionadoPorId: casa.editor!.usuario.id, tags: ['Zeta', 'alfa'], preco: '5.5' });
    const p2 = await criarProdutoDeTeste(casa.casaId, { nome: 'Segundo' });
    await criarProdutoDeTeste(outra.casaId, { nome: 'Alheio' });
    await criarFotoDeTeste(p1.id, { chave: await foto(casa.casaId), ordem: 1 });
    await criarFotoDeTeste(p1.id, { chave: await foto(casa.casaId), ordem: 0 });

    const res = await get('/produtos', casa.leitor!.token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ pagina: 1, limite: 20, total: 2, totalPaginas: 1 });
    expect(res.body.itens.map((i: { id: number }) => i.id)).toEqual([p2.id, p1.id]);
    expect(res.body.itens[1]).toEqual({
      id: p1.id,
      nome: 'Primeiro',
      preco: '5.50',
      quantidade: 1,
      dataCompra: '2026-01-15',
      dataCadastro: expect.any(String),
      tags: [{ id: expect.any(Number), nome: 'alfa' }, { id: expect.any(Number), nome: 'Zeta' }],
      fotoCapa: { url: expect.stringContaining('X-Amz-Signature'), expiraEm: expect.any(String) },
      adicionadoPor: { id: casa.editor!.usuario.id, nome: casa.editor!.usuario.nome },
    });
    expect(res.body.itens[0].fotoCapa).toBeNull();
    expect(res.body.itens[0].adicionadoPor).toBeNull();
    expect(res.body.itens[0]).not.toHaveProperty('descricao');
  });

  it('a capa é a foto de menor ordem', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId);
    const capa = await foto(casa.casaId);
    await criarFotoDeTeste(p.id, { chave: await foto(casa.casaId), ordem: 1 });
    await criarFotoDeTeste(p.id, { chave: capa, ordem: 0 });
    const res = await get('/produtos', casa.admin.token);
    expect(res.body.itens[0].fotoCapa.url).toContain(capa);
  });

  it('Casa sem produtos: lista vazia com totalPaginas 0', async () => {
    const casa = await montarCasa();
    expect((await get('/produtos', casa.admin.token)).body).toEqual({ itens: [], pagina: 1, limite: 20, total: 0, totalPaginas: 0 });
  });

  it('busca por nome: contém, sem diferenciar caixa; texto sem resultado devolve vazio', async () => {
    const casa = await montarCasa();
    await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira Elétrica' });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Moedor de CAFÉ' });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Geladeira' });
    const nomes = async (q: string) => (await get(`/produtos?busca=${encodeURIComponent(q)}&ordem=nome`, casa.admin.token)).body.itens.map((i: { nome: string }) => i.nome);
    expect(await nomes('cafeteira')).toEqual(['Cafeteira Elétrica']);
    expect(await nomes('ELÉTR')).toEqual(['Cafeteira Elétrica']);
    expect(await nomes('eira')).toEqual(['Cafeteira Elétrica', 'Geladeira']);
    expect(await nomes('café')).toEqual(['Moedor de CAFÉ']);
    expect(await nomes('cafe')).toEqual(['Cafeteira Elétrica']); // sem normalizar acentos: "café" ≠ "cafe"
    expect(await nomes('xyz')).toEqual([]);
    expect(await nomes('   ')).toHaveLength(3); // vazio = sem busca
  });

  it('%, _ e \\ na busca valem como texto literal', async () => {
    const casa = await montarCasa();
    await criarProdutoDeTeste(casa.casaId, { nome: 'Desconto 50% off' });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Cabo_USB' });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Caminho C:\\temp' });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Outro qualquer' });
    const total = async (q: string) => (await get(`/produtos?busca=${encodeURIComponent(q)}`, casa.admin.token)).body.total;
    expect(await total('%')).toBe(1);
    expect(await total('_')).toBe(1);
    expect(await total('\\')).toBe(1);
    expect(await total('Ca_o')).toBe(0);
  });

  it('filtro por tag e combinação com a busca (E); tag de outra Casa ou inexistente: lista vazia', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ prefixo: 'o' });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Panela', tags: ['Cozinha'] });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira', tags: ['Cozinha', 'Eletro'] });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Sofá', tags: ['Sala'] });
    const cozinha = await prisma.tag.findFirstOrThrow({ where: { casaId: casa.casaId, nome: 'Cozinha' } });
    const alheia = await criarTagDeTeste(outra.casaId, 'Cozinha');
    const nomes = async (qs: string) => (await get(`/produtos?${qs}&ordem=nome`, casa.admin.token)).body.itens.map((i: { nome: string }) => i.nome);
    expect(await nomes(`tagId=${cozinha.id}`)).toEqual(['Cafeteira', 'Panela']);
    expect(await nomes(`tagId=${cozinha.id}&busca=cafe`)).toEqual(['Cafeteira']);
    expect(await nomes(`tagId=${alheia.id}`)).toEqual([]);
    expect(await nomes('tagId=999999')).toEqual([]);
  });

  it('paginação: página, limite, total, totalPaginas; página além do fim devolve itens vazios', async () => {
    const casa = await montarCasa();
    for (let i = 1; i <= 5; i++) await criarProdutoDeTeste(casa.casaId, { nome: `Item ${i}` });
    const p1 = await get('/produtos?limite=2&pagina=1&ordem=nome', casa.admin.token);
    const p3 = await get('/produtos?limite=2&pagina=3&ordem=nome', casa.admin.token);
    const p4 = await get('/produtos?limite=2&pagina=4&ordem=nome', casa.admin.token);
    expect(p1.body).toMatchObject({ pagina: 1, limite: 2, total: 5, totalPaginas: 3 });
    expect(p1.body.itens.map((i: { nome: string }) => i.nome)).toEqual(['Item 1', 'Item 2']);
    expect(p3.body.itens.map((i: { nome: string }) => i.nome)).toEqual(['Item 5']);
    expect(p4.status).toBe(200);
    expect(p4.body).toMatchObject({ itens: [], pagina: 4, total: 5, totalPaginas: 3 });
  });

  it('limite máximo 100 aceito; recentes da tela 05 = limite 5', async () => {
    const casa = await montarCasa();
    for (let i = 1; i <= 7; i++) await criarProdutoDeTeste(casa.casaId, { nome: `Item ${i}` });
    expect((await get('/produtos?limite=100', casa.admin.token)).status).toBe(200);
    const rec = await get('/produtos?limite=5', casa.admin.token);
    expect(rec.body.itens.map((i: { nome: string }) => i.nome)).toEqual(['Item 7', 'Item 6', 'Item 5', 'Item 4', 'Item 3']);
  });

  it('ordem "nome" ignora caixa; "recentes" usa dataCadastro decrescente com desempate por id', async () => {
    const casa = await montarCasa();
    await criarProdutoDeTeste(casa.casaId, { nome: 'banana' });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Abacaxi' });
    await criarProdutoDeTeste(casa.casaId, { nome: 'Cereja' });
    const porNome = await get('/produtos?ordem=nome', casa.admin.token);
    expect(porNome.body.itens.map((i: { nome: string }) => i.nome)).toEqual(['Abacaxi', 'banana', 'Cereja']);
    await prisma.$executeRaw`UPDATE produto SET data_cadastro = '2026-01-01T00:00:00Z'`; // todos iguais: desempate por id desc
    const rec = await get('/produtos', casa.admin.token);
    expect(rec.body.itens.map((i: { nome: string }) => i.nome)).toEqual(['Cereja', 'Abacaxi', 'banana']);
  });

  it.each([
    ['pagina 0', 'pagina=0'],
    ['pagina negativa', 'pagina=-1'],
    ['pagina texto', 'pagina=abc'],
    ['pagina fracionada', 'pagina=1.5'],
    ['limite 0', 'limite=0'],
    ['limite 101', 'limite=101'],
    ['ordem inválida', 'ordem=preco'],
    ['tagId texto', 'tagId=abc'],
    ['tagId vazio', 'tagId='],
    ['tagId 0', 'tagId=0'],
    ['busca com 121', `busca=${'a'.repeat(121)}`],
    ['busca repetida', 'busca=a&busca=b'],
  ])('%s: 422 DADOS_INVALIDOS', async (_n, qs) => {
    const casa = await montarCasa();
    const res = await get(`/produtos?${qs}`, casa.admin.token);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('DADOS_INVALIDOS');
  });
});

// =================================================================================================================
describe('GET /produtos/:id · detalhe', () => {
  it('matriz de papéis: todos da Casa leem; outra Casa 404 (nunca 403); sem token 401', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId);
    await testarMatrizDePapeis(casa, (t) => get(`/produtos/${p.id}`, t), { semToken: 401, LEITOR: 200, EDITOR: 200, outraCasa: 404, ADMIN: 200 });
  });

  it('devolve ProdutoDetalhe com descrição, fotos ordenadas, tags e autor', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId, { nome: 'TV', descricao: 'Sala', preco: '3000', tags: ['Sala'], adicionadoPorId: casa.admin.usuario.id });
    const f1 = await criarFotoDeTeste(p.id, { chave: await foto(casa.casaId), ordem: 1, tamanhoBytes: 70 });
    const f0 = await criarFotoDeTeste(p.id, { chave: await foto(casa.casaId), ordem: 0, tamanhoBytes: 70 });
    const res = await get(`/produtos/${p.id}`, casa.leitor!.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: p.id, nome: 'TV', descricao: 'Sala', preco: '3000.00', tags: [{ nome: 'Sala' }], adicionadoPor: { id: casa.admin.usuario.id } });
    expect(res.body.fotos.map((f: { id: number }) => f.id)).toEqual([f0.id, f1.id]);
    expect(res.body.fotos[0]).toMatchObject({ ordem: 0, tipo: 'JPEG', tamanhoBytes: 70 });
    expect(res.body.fotos[0]).not.toHaveProperty('chave');
    expect(res.body).not.toHaveProperty('casaId');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('inexistente: 404; id inválido: 422', async () => {
    const casa = await montarCasa();
    expect((await get('/produtos/999999', casa.admin.token)).status).toBe(404);
    for (const id of ['abc', '0', '-1', '1.5', '99999999999']) {
      expect((await get(`/produtos/${id}`, casa.admin.token)).status, id).toBe(422);
    }
  });
});

// =================================================================================================================
describe('PATCH /produtos/:id · edição', () => {
  async function comProduto(opcoes: Parameters<typeof criarProdutoDeTeste>[1] = {}) {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira', descricao: 'Antiga', preco: '100.00', quantidade: 2, ...opcoes });
    return { casa, p };
  }

  it('matriz de papéis: LEITOR 403; EDITOR e ADMIN editam; outra Casa 404', async () => {
    const { casa, p } = await comProduto();
    await testarMatrizDePapeis(casa, (t, quem) => patch(`/produtos/${p.id}`, t, { quantidade: quem === 'EDITOR' ? 3 : 4 }), {
      semToken: 401, LEITOR: 403, EDITOR: 200, outraCasa: 404, ADMIN: 200,
    });
  });

  it('altera campos, devolve o detalhe, atualiza atualizadoEm e registra PRODUTO_ALTERADO com antes/depois', async () => {
    const { casa, p } = await comProduto();
    const antes = p.atualizadoEm;
    const res = await patch(`/produtos/${p.id}`, casa.editor!.token, {
      nome: ' Cafeteira Nova ', descricao: 'Nova', preco: '150.5', quantidade: 4, dataCompra: '2025-06-01',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nome: 'Cafeteira Nova', descricao: 'Nova', preco: '150.50', quantidade: 4, dataCompra: '2025-06-01' });
    expect(new Date(res.body.atualizadoEm).getTime()).toBeGreaterThan(antes.getTime());
    const [log, ...resto] = await logs('PRODUTO_ALTERADO');
    expect(resto).toHaveLength(0);
    expect(log).toMatchObject({ usuarioId: casa.editor!.usuario.id, entidadeId: p.id });
    expect(log!.detalhes).toEqual({
      alteracoes: {
        nome: { de: 'Cafeteira', para: 'Cafeteira Nova' },
        descricao: { de: 'Antiga', para: 'Nova' },
        preco: { de: '100.00', para: '150.50' },
        quantidade: { de: 2, para: 4 },
        dataCompra: { de: '2026-01-15', para: '2025-06-01' },
      },
    });
  });

  it('só os campos enviados mudam; o evento traz só o que mudou', async () => {
    const { casa, p } = await comProduto();
    const res = await patch(`/produtos/${p.id}`, casa.admin.token, { preco: '1.00' });
    expect(res.body).toMatchObject({ nome: 'Cafeteira', descricao: 'Antiga', quantidade: 2, preco: '1.00' });
    expect((await logs('PRODUTO_ALTERADO'))[0]!.detalhes).toEqual({ alteracoes: { preco: { de: '100.00', para: '1.00' } } });
  });

  it('descricao null ou vazia limpa a descrição', async () => {
    const { casa, p } = await comProduto();
    expect((await patch(`/produtos/${p.id}`, casa.admin.token, { descricao: null })).body.descricao).toBeNull();
    await prisma.produto.update({ where: { id: p.id }, data: { descricao: 'De novo' } });
    expect((await patch(`/produtos/${p.id}`, casa.admin.token, { descricao: '  ' })).body.descricao).toBeNull();
  });

  it('sem mudança real: 200, sem evento, sem log e atualizadoEm intacto', async () => {
    const { casa, p } = await comProduto({ tags: ['Cozinha'] });
    const tag = await prisma.tag.findFirstOrThrow({ where: { casaId: casa.casaId } });
    const antes = await prisma.produto.findUniqueOrThrow({ where: { id: p.id } });
    const res = await patch(`/produtos/${p.id}`, casa.admin.token, {
      nome: 'Cafeteira', descricao: 'Antiga', preco: '100', quantidade: 2, dataCompra: '2026-01-15', tagIds: [tag.id], fotos: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.nome).toBe('Cafeteira');
    expect(await logs('PRODUTO_ALTERADO')).toHaveLength(0);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).atualizadoEm).toEqual(antes.atualizadoEm);
  });

  it('mudar o nome para um já existente NÃO é bloqueado (sem verificação de duplicidade)', async () => {
    const { casa, p } = await comProduto();
    await criarProdutoDeTeste(casa.casaId, { nome: 'Geladeira' });
    const res = await patch(`/produtos/${p.id}`, casa.admin.token, { nome: 'geladeira' });
    expect(res.status).toBe(200);
    expect(await prisma.produto.count({ where: { casaId: casa.casaId } })).toBe(2);
  });

  it('tagIds substitui a lista; [] remove todas; o evento traz nomes adicionados e removidos', async () => {
    const { casa, p } = await comProduto({ tags: ['Cozinha', 'Velha'] });
    const nova = await criarTagDeTeste(casa.casaId, 'Nova');
    const cozinha = await prisma.tag.findFirstOrThrow({ where: { casaId: casa.casaId, nome: 'Cozinha' } });
    const r1 = await patch(`/produtos/${p.id}`, casa.admin.token, { tagIds: [cozinha.id, nova.id] });
    expect(r1.body.tags.map((t: { nome: string }) => t.nome)).toEqual(['Cozinha', 'Nova']);
    expect((await logs('PRODUTO_ALTERADO'))[0]!.detalhes).toEqual({ alteracoes: { tags: { adicionadas: ['Nova'], removidas: ['Velha'] } } });
    const r2 = await patch(`/produtos/${p.id}`, casa.admin.token, { tagIds: [] });
    expect(r2.body.tags).toEqual([]);
    expect(await prisma.tag.count({ where: { casaId: casa.casaId } })).toBe(3); // as tags continuam existindo
  });

  it('tag de outra Casa: 422 e nada muda', async () => {
    const { casa, p } = await comProduto();
    const outra = await montarCasa({ prefixo: 'o' });
    const alheia = await criarTagDeTeste(outra.casaId, 'Alheia');
    const res = await patch(`/produtos/${p.id}`, casa.admin.token, { quantidade: 9, tagIds: [alheia.id] });
    expect(res.status).toBe(422);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidade).toBe(2);
  });

  it.each([
    ['corpo vazio', {}],
    ['só campos desconhecidos', { casaId: 3, foo: 1 }],
    ['nome vazio', { nome: ' ' }],
    ['nome null', { nome: null }],
    ['preço inválido', { preco: '1,5' }],
    ['quantidade 0', { quantidade: 0 }],
    ['data futura', { dataCompra: '2999-01-01' }],
    ['11 tags', { tagIds: Array.from({ length: 11 }, (_, i) => i + 1) }],
    ['fotos item sem id nem chave', { fotos: [{}] }],
    ['fotos repetidas', { fotos: [{ id: 1 }, { id: 1 }] }],
  ])('%s: 422 DADOS_INVALIDOS', async (_n, corpo) => {
    const { casa, p } = await comProduto();
    const res = await patch(`/produtos/${p.id}`, casa.admin.token, corpo);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('DADOS_INVALIDOS');
  });

  it('casaId e adicionadoPorId do corpo são ignorados', async () => {
    const { casa, p } = await comProduto();
    const outra = await montarCasa({ prefixo: 'o' });
    const res = await patch(`/produtos/${p.id}`, casa.admin.token, { quantidade: 9, casaId: outra.casaId, adicionadoPorId: 123 });
    expect(res.status).toBe(200);
    expect(await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ casaId: casa.casaId, adicionadoPorId: null });
  });

  it('produto inexistente: 404; de outra Casa: 404 e nada muda', async () => {
    const { casa, p } = await comProduto();
    const outra = await montarCasa({ prefixo: 'o' });
    expect((await patch('/produtos/999999', casa.admin.token, { quantidade: 5 })).status).toBe(404);
    expect((await patch(`/produtos/${p.id}`, outra.admin.token, { quantidade: 5 })).status).toBe(404);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidade).toBe(2);
  });

  // ------------------------------------------------------------ fotos na edição
  describe('fotos', () => {
    it('adiciona foto nova (confirmada nos bytes), mantém a existente e registra contagens', async () => {
      const { casa, p } = await comProduto();
      const f0 = await criarFotoDeTeste(p.id, { chave: await foto(casa.casaId), ordem: 0, tamanhoBytes: 70, tipo: 'PNG' });
      const nova = await foto(casa.casaId, await gerarImagemDeTeste('JPEG'), 'jpg');
      const res = await patch(`/produtos/${p.id}`, casa.editor!.token, { fotos: [{ id: f0.id }, { chave: nova }] });
      expect(res.status).toBe(200);
      expect(res.body.fotos.map((f: { ordem: number; tipo: string }) => [f.ordem, f.tipo])).toEqual([[0, 'PNG'], [1, 'JPEG']]);
      expect((await logs('PRODUTO_ALTERADO'))[0]!.detalhes).toEqual({ alteracoes: { fotos: { adicionadas: 1, removidas: 0 } } });
    });

    it('remove foto que sumiu da lista e apaga o objeto do S3 depois de gravar', async () => {
      const { casa, p } = await comProduto();
      const chave = await foto(casa.casaId);
      const f = await criarFotoDeTeste(p.id, { chave, tamanhoBytes: 70 });
      const res = await patch(`/produtos/${p.id}`, casa.admin.token, { fotos: [] });
      expect(res.body.fotos).toEqual([]);
      expect(await prisma.foto.count({ where: { id: f.id } })).toBe(0);
      expect(await obterMetadados(chave)).toBeNull();
      expect((await logs('PRODUTO_ALTERADO'))[0]!.detalhes).toEqual({ alteracoes: { fotos: { adicionadas: 0, removidas: 1 } } });
    });

    it('reordenar muda a capa e conta como alteração (0 adicionadas, 0 removidas)', async () => {
      const { casa, p } = await comProduto();
      const a = await criarFotoDeTeste(p.id, { ordem: 0 });
      const b = await criarFotoDeTeste(p.id, { ordem: 1 });
      const res = await patch(`/produtos/${p.id}`, casa.admin.token, { fotos: [{ id: b.id }, { id: a.id }] });
      expect(res.body.fotos.map((f: { id: number }) => f.id)).toEqual([b.id, a.id]);
      expect((await logs('PRODUTO_ALTERADO'))[0]!.detalhes).toEqual({ alteracoes: { fotos: { adicionadas: 0, removidas: 0 } } });
    });

    it('omitir fotos não mexe nelas', async () => {
      const { casa, p } = await comProduto();
      await criarFotoDeTeste(p.id);
      const res = await patch(`/produtos/${p.id}`, casa.admin.token, { quantidade: 7 });
      expect(res.body.fotos).toHaveLength(1);
    });

    it('id de foto de outro produto: 422 em fotos.N.id', async () => {
      const { casa, p } = await comProduto();
      const outro = await criarProdutoDeTeste(casa.casaId, { nome: 'Outro' });
      const alheia = await criarFotoDeTeste(outro.id);
      const res = await patch(`/produtos/${p.id}`, casa.admin.token, { fotos: [{ id: alheia.id }] });
      expect(res.status).toBe(422);
      expect(res.body.details[0].campo).toBe('fotos.0.id');
      expect(await prisma.foto.count({ where: { id: alheia.id } })).toBe(1);
    });

    it('mais de 3 fotos: 422 LIMITE_FOTOS', async () => {
      const { casa, p } = await comProduto();
      const chaves = await Promise.all([1, 2, 3, 4].map(() => foto(casa.casaId)));
      const res = await patch(`/produtos/${p.id}`, casa.admin.token, { fotos: chaves.map((chave) => ({ chave })) });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('LIMITE_FOTOS');
    });

    it('arquivo inválido na edição: 422 ARQUIVO_INVALIDO, objeto apagado e nada muda', async () => {
      const { casa, p } = await comProduto();
      const chave = await foto(casa.casaId, Buffer.from('not an image'));
      const res = await patch(`/produtos/${p.id}`, casa.admin.token, { quantidade: 9, fotos: [{ chave }] });
      expect(res.status).toBe(422);
      expect(res.body.details[0].campo).toBe('fotos.0');
      expect(await obterMetadados(chave)).toBeNull();
      expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidade).toBe(2);
    });

    it('cota pelo saldo líquido: estoura → 409 e nada muda; troca por foto menor passa mesmo no limite', async () => {
      const { casa, p } = await comProduto();
      // Casa exatamente no limite com uma foto grande.
      const grande = await criarFotoDeTeste(p.id, { chave: await foto(casa.casaId), tamanhoBytes: BYTES_POR_GB, ordem: 0 });
      const nova1 = await foto(casa.casaId);
      // adicionar sem remover: saldo +70 → estoura
      const r1 = await patch(`/produtos/${p.id}`, casa.admin.token, { quantidade: 9, fotos: [{ id: grande.id }, { chave: nova1 }] });
      expect(r1.status).toBe(409);
      expect(r1.body).toMatchObject({ error: 'COTA_EXCEDIDA', details: { usadoBytes: BYTES_POR_GB, limiteBytes: BYTES_POR_GB } });
      expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidade).toBe(2);
      expect(await obterMetadados(nova1)).not.toBeNull();
      // trocar a grande pela pequena: saldo negativo → passa
      const r2 = await patch(`/produtos/${p.id}`, casa.admin.token, { fotos: [{ chave: nova1 }] });
      expect(r2.status).toBe(200);
      expect(r2.body.fotos).toHaveLength(1);
    });

    it('duas edições simultâneas na cota: só cabe uma (Casa travada)', async () => {
      const casa = await montarCasa();
      const p1 = await criarProdutoDeTeste(casa.casaId, { nome: 'A' });
      const p2 = await criarProdutoDeTeste(casa.casaId, { nome: 'B' });
      const pesada = await criarProdutoDeTeste(casa.casaId, { nome: 'Peso' });
      await criarFotoDeTeste(pesada.id, { tamanhoBytes: BYTES_POR_GB - 100 });
      const [c1, c2] = [await foto(casa.casaId), await foto(casa.casaId)]; // 70 bytes cada: só uma cabe
      const [r1, r2] = await Promise.all([
        patch(`/produtos/${p1.id}`, casa.admin.token, { fotos: [{ chave: c1 }] }),
        patch(`/produtos/${p2.id}`, casa.admin.token, { fotos: [{ chave: c2 }] }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    });
  });
});

// =================================================================================================================
describe('DELETE /produtos/:id', () => {
  it('matriz de papéis: LEITOR 403; EDITOR exclui (204); depois 404 para ADMIN e outra Casa', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId);
    await testarMatrizDePapeis(casa, (t) => del(`/produtos/${p.id}`, t), { semToken: 401, LEITOR: 403, EDITOR: 204, outraCasa: 404, ADMIN: 404 });
  });

  it('exclui produto, fotos e vínculos (tags continuam), apaga os objetos do S3 e audita com os dados do produto', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId, { nome: 'TV', quantidade: 3, preco: '2000', tags: ['Sala'] });
    const chave = await foto(casa.casaId);
    await criarFotoDeTeste(p.id, { chave });
    const res = await del(`/produtos/${p.id}`, casa.admin.token);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(await prisma.produto.count()).toBe(0);
    expect(await prisma.foto.count()).toBe(0);
    expect(await prisma.produtoTag.count()).toBe(0);
    expect(await prisma.tag.count()).toBe(1);
    expect(await obterMetadados(chave)).toBeNull();
    const [log] = await logs('PRODUTO_EXCLUIDO');
    expect(log).toMatchObject({ usuarioId: casa.admin.usuario.id, casaId: casa.casaId, entidade: 'Produto', entidadeId: p.id });
    expect(log!.detalhes).toEqual({ nome: 'TV', quantidade: 3, preco: '2000.00', fotos: 1 });
  });

  it('a exclusão libera a cota de armazenamento', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId);
    await criarFotoDeTeste(p.id, { tamanhoBytes: BYTES_POR_GB });
    const url = (t: string) => post('/produtos/fotos/upload-url', t, { tipo: 'image/png', tamanhoBytes: 10 });
    expect((await url(casa.admin.token)).status).toBe(409);
    await del(`/produtos/${p.id}`, casa.admin.token);
    expect((await url(casa.admin.token)).status).toBe(200);
  });

  it('upload-url com a cota cheia: troca de foto (substituiFotoIds) de saldo líquido ≤ 0 devolve a URL', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ prefixo: 'o' });
    const p = await criarProdutoDeTeste(casa.casaId);
    const po = await criarProdutoDeTeste(outra.casaId);
    const cheia = await criarFotoDeTeste(p.id, { tamanhoBytes: BYTES_POR_GB - 100 });
    const pequena = await criarFotoDeTeste(p.id, { tamanhoBytes: 100 });
    const alheia = await criarFotoDeTeste(po.id, { tamanhoBytes: 1000 });
    const url = (corpo: object) => post('/produtos/fotos/upload-url', casa.admin.token, { tipo: 'image/png', tamanhoBytes: 500, ...corpo });
    // Sem informar a troca, continua bloqueado.
    expect((await url({})).status).toBe(409);
    // Foto de outra Casa não libera nada.
    expect((await url({ substituiFotoIds: [alheia.id] })).status).toBe(409);
    // Troca da própria foto: saldo líquido negativo, passa.
    const ok = await url({ substituiFotoIds: [cheia.id] });
    expect(ok.status).toBe(200);
    // Troca que ainda estoura (nova de 500 B no lugar de uma de 100 B) continua 409.
    expect((await url({ substituiFotoIds: [pequena.id] })).status).toBe(409);
    // Corpo malformado: 422.
    expect((await url({ substituiFotoIds: ['x'] })).status).toBe(422);
  });

  it('produto de outra Casa: 404 e continua existindo; id inválido: 422', async () => {
    const casa = await montarCasa();
    const outra = await montarCasa({ prefixo: 'o' });
    const p = await criarProdutoDeTeste(outra.casaId);
    expect((await del(`/produtos/${p.id}`, casa.admin.token)).status).toBe(404);
    expect(await prisma.produto.count()).toBe(1);
    expect(await logs('PRODUTO_EXCLUIDO')).toHaveLength(0);
    expect((await del('/produtos/abc', casa.admin.token)).status).toBe(422);
  });

  it('duas exclusões simultâneas: uma 204 e a outra 404, com um único log', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId);
    const rs = await Promise.all([del(`/produtos/${p.id}`, casa.admin.token), del(`/produtos/${p.id}`, casa.editor!.token)]);
    expect(rs.map((r) => r.status).sort()).toEqual([204, 404]);
    expect(await logs('PRODUTO_EXCLUIDO')).toHaveLength(1);
  });
});

// =================================================================================================================
describe('GET /produtos/:id/historico', () => {
  it('matriz de papéis: todos da Casa leem; outra Casa 404; sem token 401', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId);
    await testarMatrizDePapeis(casa, (t) => get(`/produtos/${p.id}/historico`, t), {
      semToken: 401, LEITOR: 200, EDITOR: 200, outraCasa: 404, ADMIN: 200,
    });
  });

  async function montarHistorico(casa: CasaDeTeste) {
    const tag = await criarTagDeTeste(casa.casaId, 'Cozinha');
    const c = await criar(casa.admin.token, { tagIds: [tag.id] });
    const id = c.body.produto.id as number;
    await patch(`/produtos/${id}`, casa.editor!.token, { preco: '300', quantidade: 2 });
    await criar(casa.editor!.token, { quantidade: 3, duplicado: 'SOMAR', duplicadoId: id });
    return id;
  }

  it('lista CRIADO, ALTERADO e QUANTIDADE_SOMADA do mais novo ao mais antigo, com autor e detalhes', async () => {
    const casa = await montarCasa();
    const id = await montarHistorico(casa);
    const res = await get(`/produtos/${id}/historico`, casa.leitor!.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pagina: 1, limite: 20, total: 3, totalPaginas: 1 });
    expect(res.body.itens.map((e: { tipo: string }) => e.tipo)).toEqual(['QUANTIDADE_SOMADA', 'ALTERADO', 'CRIADO']);
    const [somada, alterado, criado] = res.body.itens;
    expect(somada).toEqual({
      id: expect.stringMatching(/^\d+$/), tipo: 'QUANTIDADE_SOMADA', criadoEm: expect.any(String),
      autor: { nome: casa.editor!.usuario.nome }, detalhes: { anterior: 2, somada: 3, final: 5 },
    });
    expect(alterado.detalhes).toEqual({ alteracoes: { preco: { de: '249.90', para: '300.00' }, quantidade: { de: 1, para: 2 } } });
    expect(criado).toMatchObject({ autor: { nome: casa.admin.usuario.nome }, detalhes: { nome: 'Cafeteira Elétrica', preco: '249.90', quantidade: 1, tags: ['Cozinha'], fotos: 0 } });
    expect(JSON.stringify(res.body)).not.toContain('@keepit.test'); // sem e-mail do autor
  });

  it('paginação do histórico e limites', async () => {
    const casa = await montarCasa();
    const id = await montarHistorico(casa);
    const p2 = await get(`/produtos/${id}/historico?limite=2&pagina=2`, casa.admin.token);
    expect(p2.body).toMatchObject({ pagina: 2, limite: 2, total: 3, totalPaginas: 2 });
    expect(p2.body.itens.map((e: { tipo: string }) => e.tipo)).toEqual(['CRIADO']);
    expect((await get(`/produtos/${id}/historico?pagina=9`, casa.admin.token)).body.itens).toEqual([]);
    for (const qs of ['limite=0', 'limite=101', 'pagina=0', 'pagina=x']) {
      expect((await get(`/produtos/${id}/historico?${qs}`, casa.admin.token)).status, qs).toBe(422);
    }
  });

  it('autor que saiu da Casa aparece como null (ex-membro)', async () => {
    const casa = await montarCasa();
    const id = await montarHistorico(casa);
    await prisma.membro.delete({ where: { usuarioId: casa.editor!.usuario.id } });
    const res = await get(`/produtos/${id}/historico`, casa.admin.token);
    expect(res.body.itens[0].autor).toBeNull();
    expect(res.body.itens[2].autor).toEqual({ nome: casa.admin.usuario.nome });
  });

  it('produto sem mudanças além da criação, evento de exclusão não aparece e histórico de produto excluído é 404', async () => {
    const casa = await montarCasa();
    const c = await criar(casa.admin.token);
    const id = c.body.produto.id;
    expect((await get(`/produtos/${id}/historico`, casa.admin.token)).body.total).toBe(1);
    await del(`/produtos/${id}`, casa.admin.token);
    expect((await get(`/produtos/${id}/historico`, casa.admin.token)).status).toBe(404);
  });

  it('no-op não gera evento', async () => {
    const casa = await montarCasa();
    const c = await criar(casa.admin.token);
    const id = c.body.produto.id;
    await patch(`/produtos/${id}`, casa.admin.token, { quantidade: 1 });
    expect((await get(`/produtos/${id}/historico`, casa.admin.token)).body.total).toBe(1);
  });
});

// =================================================================================================================
describe('Validação de entrada (AppSec FD9/FD13)', () => {
  it('dataCompra aceita o piso 1900-01-01', async () => {
    const casa = await montarCasa();
    expect((await criar(casa.admin.token, { dataCompra: '1900-01-01' })).status).toBe(201);
  });

  it('nome: NFC, espaços internos reduzidos e emoji composto (U+200D, U+FE0F) permitido', async () => {
    const casa = await montarCasa();
    const decomposto = 'Cafe\u0301   Torrado\u00A0Forte'; // "é" decomposto + vários espaços + NBSP
    const res = await criar(casa.admin.token, { nome: decomposto });
    expect(res.status).toBe(201);
    expect(res.body.produto.nome).toBe('Caf\u00E9 Torrado Forte');
    const emoji = await criar(casa.admin.token, { nome: 'Fam\u00EDlia \u{1F468}\u200D\u{1F469}\u200D\u{1F467} \u2764\uFE0F' });
    expect(emoji.status).toBe(201);
  });

  it('a duplicidade não é burlada por forma decomposta nem por espaços repetidos', async () => {
    const casa = await montarCasa();
    await criarProdutoDeTeste(casa.casaId, { nome: 'Caf\u00E9 Forte' });
    const res = await criar(casa.admin.token, { nome: 'Cafe\u0301   forte' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PRODUTO_DUPLICADO');
  });

  it('PATCH também recusa preço numérico, controle invisível e data antes de 1900', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId);
    for (const corpo of [{ preco: 1.5 }, { nome: 'a\u200Bb' }, { dataCompra: '0001-01-01' }]) {
      expect((await patch(`/produtos/${p.id}`, casa.admin.token, corpo)).status, JSON.stringify(corpo)).toBe(422);
    }
  });

  it('busca com NUL ou controle invisível: 422 (antes era 500)', async () => {
    const casa = await montarCasa();
    for (const busca of ['%00', 'a%00b', '%0A', '%E2%80%AE', '%E2%80%8B']) {
      const res = await get(`/produtos?busca=${busca}`, casa.admin.token);
      expect(res.status, busca).toBe(422);
      expect(res.body.error).toBe('DADOS_INVALIDOS');
    }
  });

  it('busca normaliza NFC e espaços (acha "Café" digitando decomposto)', async () => {
    const casa = await montarCasa();
    await criarProdutoDeTeste(casa.casaId, { nome: 'Caf\u00E9 Torrado' });
    const res = await get(`/produtos?busca=${encodeURIComponent('cafe\u0301  torrado')}`, casa.admin.token);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it('pagina: 10.000 aceita; 10.001 recusada (lista e histórico)', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId);
    expect((await get('/produtos?pagina=10000', casa.admin.token)).status).toBe(200);
    expect((await get('/produtos?pagina=10001', casa.admin.token)).status).toBe(422);
    expect((await get(`/produtos/${p.id}/historico?pagina=10000`, casa.admin.token)).status).toBe(200);
    expect((await get(`/produtos/${p.id}/historico?pagina=10001`, casa.admin.token)).status).toBe(422);
  });

  it('tag: controle invisível recusado e nome normalizado', async () => {
    const casa = await montarCasa();
    const ruim = await post('/tags', casa.admin.token, { nome: 'coz\u202Einha' });
    expect(ruim.status).toBe(422);
    const ok = await post('/tags', casa.admin.token, { nome: '  Cafe\u0301   forte ' });
    expect(ok.status).toBe(201);
    expect(ok.body.nome).toBe('Caf\u00E9 forte');
    expect((await post('/tags', casa.admin.token, { nome: 'CAF\u00C9 FORTE' })).status).toBe(409);
  });
});

// =================================================================================================================
describe('Saneamento e imutabilidade das fotos (AppSec FD1, FD5, FD7, FD13)', () => {
  const put = (url: string, corpo: Buffer, tipo = 'image/png') =>
    fetch(url, { method: 'PUT', headers: { 'Content-Type': tipo }, body: new Uint8Array(corpo) });

  async function pedirEnvio(token: string, tipo: string, tamanhoBytes: number) {
    const res = await post('/produtos/fotos/upload-url', token, { tipo, tamanhoBytes });
    expect(res.status).toBe(200);
    objetos.push(res.body.chave, chaveFinalDoEnvio(res.body.chave));
    return res.body as { chave: string; url: string };
  }

  it('tipo real diferente do declarado (PNG declarado, bytes JPEG): 422 ARQUIVO_INVALIDO e nada é gravado', async () => {
    const casa = await montarCasa();
    const jpeg = await gerarImagemDeTeste('JPEG');
    const envio = await pedirEnvio(casa.editor!.token, 'image/png', jpeg.length);
    expect((await put(envio.url, jpeg, 'image/png')).status).toBe(200);
    const res = await criar(casa.editor!.token, { fotos: [{ chave: envio.chave }] });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: 'ARQUIVO_INVALIDO', details: [{ campo: 'fotos.0' }] });
    expect(await prisma.produto.count()).toBe(0);
    expect(await prisma.foto.count()).toBe(0);
    expect(await obterMetadados(envio.chave)).toBeNull();
    expect(await obterMetadados(chaveFinalDoEnvio(envio.chave))).toBeNull();
  });

  it('o inverso (JPEG declarado, bytes PNG) também é recusado, inclusive na edição', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId);
    const envio = await pedirEnvio(casa.editor!.token, 'image/jpeg', PNG_1X1.length);
    expect((await put(envio.url, PNG_1X1, 'image/jpeg')).status).toBe(200);
    const res = await patch(`/produtos/${p.id}`, casa.editor!.token, { fotos: [{ chave: envio.chave }] });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('ARQUIVO_INVALIDO');
  });

  it('regravar na URL de envio depois da confirmação NÃO altera a foto servida (chave definitiva nunca teve URL de escrita)', async () => {
    const casa = await montarCasa();
    const envio = await pedirEnvio(casa.editor!.token, 'image/png', PNG_1X1.length);
    expect((await put(envio.url, PNG_1X1)).status).toBe(200);
    const res = await criar(casa.editor!.token, { fotos: [{ chave: envio.chave }] });
    expect(res.status).toBe(201);
    const definitiva = chaveFinalDoEnvio(envio.chave);
    expect(res.body.produto.fotos[0].url).toContain(definitiva);
    expect(res.body.produto.fotos[0].url).not.toContain('/pendentes/');
    const antes = (await prisma.foto.findFirstOrThrow({ where: { chave: definitiva } })).tamanhoBytes;

    // Ataque: novo PUT na MESMA URL, bytes diferentes do mesmo tamanho (assinatura PNG + script).
    const malicioso = Buffer.concat([PNG_1X1.subarray(0, 8), Buffer.from('<script>alert(1)</script>'.padEnd(PNG_1X1.length - 8, ' '))]);
    expect(malicioso.length).toBe(PNG_1X1.length);
    await put(envio.url, malicioso); // pode até aceitar: só alcança a área de envio
    const servida = Buffer.from(await (await fetch(res.body.produto.fotos[0].url.replace(/^https?:\/\/[^/]+/, S3_INTERNO))).arrayBuffer());
    expect(servida.includes(Buffer.from('<script>'))).toBe(false);
    expect(servida.subarray(0, 8).equals(PNG_1X1.subarray(0, 8))).toBe(true);
    expect((await prisma.foto.findFirstOrThrow({ where: { chave: definitiva } })).tamanhoBytes).toBe(antes);
    // O objeto regravado ficou só na área de envio e não pode virar foto de novo (o envio original já foi confirmado).
    const reuso = await criar(casa.editor!.token, { nome: 'Outro', fotos: [{ chave: envio.chave }] });
    expect(reuso.status).toBe(422);
  });

  it('o navegador não consegue gravar na chave definitiva: a URL de envio aponta para pendentes/', async () => {
    const casa = await montarCasa();
    const envio = await pedirEnvio(casa.editor!.token, 'image/png', PNG_1X1.length);
    expect(envio.url).toContain(`/casas/${casa.casaId}/pendentes/`);
    expect(envio.url).not.toContain('/fotos/');
    // Informar uma chave definitiva como se fosse de envio é recusado.
    const res = await criar(casa.editor!.token, { fotos: [{ chave: chaveFinalDoEnvio(envio.chave) }] });
    expect(res.status).toBe(422);
  });

  it('EXIF/GPS é removido: o objeto servido não tem metadados e a imagem segue legível', async () => {
    const casa = await montarCasa();
    const comExif = await gerarImagemDeTeste('JPEG', 40, 30, true);
    expect((await sharp(comExif).metadata()).exif).toBeDefined(); // pré-condição: a foto de origem tem EXIF
    const envio = await pedirEnvio(casa.editor!.token, 'image/jpeg', comExif.length);
    expect((await put(envio.url, comExif, 'image/jpeg')).status).toBe(200);
    const res = await criar(casa.editor!.token, { fotos: [{ chave: envio.chave }] });
    expect(res.status).toBe(201);
    const foto0 = res.body.produto.fotos[0];
    const baixado = Buffer.from(await (await fetch(foto0.url.replace(/^https?:\/\/[^/]+/, S3_INTERNO))).arrayBuffer());
    const meta = await sharp(baixado).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(baixado.includes(Buffer.from('dono-do-celular'))).toBe(false);
    expect([meta.width, meta.height]).toEqual([40, 30]);
    expect(foto0.tamanhoBytes).toBe(baixado.length);
  });

  it('arquivo poliglota (PNG válido com script depois do IEND) sai sem o script', async () => {
    const casa = await montarCasa();
    const poliglota = Buffer.concat([PNG_1X1, Buffer.from('<script>alert(document.cookie)</script>')]);
    const envio = await pedirEnvio(casa.editor!.token, 'image/png', poliglota.length);
    expect((await put(envio.url, poliglota)).status).toBe(200);
    const res = await criar(casa.editor!.token, { fotos: [{ chave: envio.chave }] });
    expect(res.status).toBe(201);
    const baixado = Buffer.from(await (await fetch(res.body.produto.fotos[0].url.replace(/^https?:\/\/[^/]+/, S3_INTERNO))).arrayBuffer());
    expect(baixado.includes(Buffer.from('<script>'))).toBe(false);
  });

  it('imagem corrompida (assinatura PNG e lixo): 422 e o objeto de envio é apagado', async () => {
    const casa = await montarCasa();
    const lixo = Buffer.concat([PNG_1X1.subarray(0, 20), Buffer.from('lixo lixo lixo')]);
    const chave = await foto(casa.casaId, lixo);
    const res = await criar(casa.editor!.token, { fotos: [{ chave }] });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('ARQUIVO_INVALIDO');
    expect(await obterMetadados(chave)).toBeNull();
  });

  it('dimensões: 8000 px por lado passa; 8001 px recusado; acima de 40 Mpx recusado', async () => {
    const casa = await montarCasa();
    const okLargo = await gerarImagemDeTeste('PNG', 8000, 2);
    const largo = await foto(casa.casaId, await gerarImagemDeTeste('PNG', 8001, 2));
    const alto = await foto(casa.casaId, await gerarImagemDeTeste('PNG', 2, 8001));
    const enorme = await foto(casa.casaId, await gerarImagemDeTeste('PNG', 7000, 6000)); // 42 Mpx, lados válidos
    const bom = await foto(casa.casaId, okLargo);
    for (const chave of [largo, alto, enorme]) {
      const res = await criar(casa.editor!.token, { fotos: [{ chave }] });
      expect(res.status, chave).toBe(422);
      expect(res.body.error).toBe('ARQUIVO_INVALIDO');
      expect(res.body.details[0].mensagem).toMatch(/8000 px|megapixels/);
      expect(await obterMetadados(chave)).toBeNull();
    }
    expect((await criar(casa.editor!.token, { fotos: [{ chave: bom }] })).status).toBe(201);
  }, 60_000);

  it('uma foto ruim junto de uma boa: nada gravado e a cópia definitiva da boa não fica no S3', async () => {
    const casa = await montarCasa();
    const boa = await foto(casa.casaId);
    const ruim = await foto(casa.casaId, Buffer.from('não sou imagem'));
    const res = await criar(casa.editor!.token, { fotos: [{ chave: boa }, { chave: ruim }] });
    expect(res.status).toBe(422);
    expect(res.body.details).toEqual([{ campo: 'fotos.1', mensagem: expect.any(String) }]);
    expect(await obterMetadados(chaveFinalDoEnvio(boa))).toBeNull();
    expect(await obterMetadados(boa)).not.toBeNull(); // pendente da boa fica para nova tentativa
  });

  it('cota estourada ao salvar: a cópia definitiva é descartada e o envio pendente continua válido', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId, { nome: 'Cheio' });
    const cheia = await criarFotoDeTeste(p.id, { tamanhoBytes: BYTES_POR_GB });
    const chave = await foto(casa.casaId);
    expect((await criar(casa.editor!.token, { fotos: [{ chave }] })).status).toBe(409);
    expect(await obterMetadados(chaveFinalDoEnvio(chave))).toBeNull();
    expect(await obterMetadados(chave)).not.toBeNull();
    await prisma.foto.delete({ where: { id: cheia.id } });
    expect((await criar(casa.editor!.token, { fotos: [{ chave }] })).status).toBe(201);
  });

  it('duas confirmações simultâneas da mesma chave: só uma foto é gravada e o objeto servido continua existindo', async () => {
    const casa = await montarCasa();
    const chave = await foto(casa.casaId);
    const rs = await Promise.all([criar(casa.editor!.token, { nome: 'A', fotos: [{ chave }] }), criar(casa.admin.token, { nome: 'B', fotos: [{ chave }] })]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(await prisma.foto.count()).toBe(1);
    expect(await obterMetadados(chaveFinalDoEnvio(chave))).not.toBeNull();
  });

  it('leitura: a URL assinada vale até 15 min, fixa tipo/inline/private e serve os cabeçalhos seguros (AppSec FD6)', async () => {
    const casa = await montarCasa();
    const chave = await foto(casa.casaId);
    const res = await criar(casa.editor!.token, { fotos: [{ chave }] });
    const url = new URL(res.body.produto.fotos[0].url);
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(900);
    expect(new Date(res.body.produto.fotos[0].expiraEm).getTime() - Date.now()).toBeLessThanOrEqual(900_000);
    const resp = await fetch(res.body.produto.fotos[0].url.replace(/^https?:\/\/[^/]+/, S3_INTERNO));
    expect(resp.headers.get('content-type')).toBe('image/png');
    expect(resp.headers.get('content-disposition')).toBe('inline');
    expect(resp.headers.get('cache-control')).toMatch(/^private/);
  });
});

// =================================================================================================================
describe('GET /me · uso.armazenamento (RF39, tela 08)', () => {
  it('todos os papéis veem o uso e o limite da Casa; o uso soma só as fotos gravadas', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId);
    await criarFotoDeTeste(p.id, { tamanhoBytes: 1500 });
    await criarFotoDeTeste(p.id, { tamanhoBytes: 500 });
    for (const t of [casa.admin.token, casa.editor!.token, casa.leitor!.token]) {
      const res = await get('/me', t);
      expect(res.status).toBe(200);
      expect(res.body.uso).toEqual({ armazenamento: { usadoBytes: 2000, limiteBytes: BYTES_POR_GB } });
    }
  });

  it('Casa sem fotos: usadoBytes 0; plano Família: limite do plano maior', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    const res = await get('/me', casa.editor!.token);
    expect(res.body.uso.armazenamento.usadoBytes).toBe(0);
    expect(res.body.uso.armazenamento.limiteBytes).toBe(res.body.plano.limiteArmazenamentoGb * BYTES_POR_GB);
    expect(res.body.uso.armazenamento.limiteBytes).toBeGreaterThan(BYTES_POR_GB);
  });

  it('o uso reflete as fotos confirmadas pela API (recodificadas) e cai ao excluir o produto', async () => {
    const casa = await montarCasa();
    const chave = await foto(casa.casaId);
    const c = await criar(casa.editor!.token, { fotos: [{ chave }] });
    const tamanho = c.body.produto.fotos[0].tamanhoBytes as number;
    expect((await get('/me', casa.leitor!.token)).body.uso.armazenamento.usadoBytes).toBe(tamanho);
    await del(`/produtos/${c.body.produto.id}`, casa.editor!.token);
    expect((await get('/me', casa.leitor!.token)).body.uso.armazenamento.usadoBytes).toBe(0);
  });
});
