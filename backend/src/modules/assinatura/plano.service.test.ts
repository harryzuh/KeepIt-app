import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { criarAssinaturaDeTeste, montarCasa } from '../../test/casa.js';
import { limparBanco } from '../../test/db.js';
import {
  BYTES_POR_GB,
  avaliarEncaixe,
  exigirCotaParaEnvio,
  exigirVagaParaMembro,
  obterCotaDaCasa,
  obterPlanoVigente,
  podeEnviarBytes,
  verificarSeCabeNoPlano,
} from './plano.service.js';

beforeEach(limparBanco);
afterAll(() => prisma.$disconnect());

const DIA = 86_400_000;

async function adicionarFoto(casaId: number, bytes: number) {
  const produto = await prisma.produto.create({
    data: { casaId, nome: 'Item', preco: '10.00', dataCompra: new Date('2026-01-01') },
  });
  await prisma.foto.create({ data: { produtoId: produto.id, chave: `x-${Date.now()}-${Math.random()}`, tipo: 'JPEG', tamanhoBytes: bytes, ordem: 0 } });
}

describe('obterPlanoVigente', () => {
  it('Casa sem assinatura é INDIVIDUAL', async () => {
    const casa = await montarCasa();
    const { plano, assinatura } = await obterPlanoVigente(casa.casaId);
    expect(plano).toMatchObject({ nome: 'INDIVIDUAL', limiteMembros: 1, limiteArmazenamentoGb: 1, preco: '0.00' });
    expect(assinatura).toBeNull();
  });

  it('ATIVA vale o plano da assinatura', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' });
    const { plano, assinatura } = await obterPlanoVigente(casa.casaId);
    expect(plano).toMatchObject({ nome: 'FAMILIA', limiteMembros: 6, limiteArmazenamentoGb: 20, preco: '19.90' });
    expect(assinatura?.status).toBe('ATIVA');
  });

  it('CANCELADA com renovação futura mantém os benefícios', async () => {
    const casa = await montarCasa({
      assinatura: { plano: 'BUSINESS', status: 'CANCELADA', dataRenovacao: new Date(Date.now() + 5 * DIA) },
    });
    const { plano, assinatura } = await obterPlanoVigente(casa.casaId);
    expect(plano.nome).toBe('BUSINESS');
    expect(assinatura?.status).toBe('CANCELADA');
  });

  it('CANCELADA já vencida (job não rodou) vale INDIVIDUAL', async () => {
    const casa = await montarCasa({
      assinatura: { plano: 'BUSINESS', status: 'CANCELADA', dataRenovacao: new Date(Date.now() - 1000) },
    });
    const { plano, assinatura } = await obterPlanoVigente(casa.casaId);
    expect(plano.nome).toBe('INDIVIDUAL');
    expect(assinatura).toBeNull();
  });

  it('no instante exato da renovação a CANCELADA já não vale', async () => {
    const agora = new Date();
    const casa = await montarCasa({ assinatura: { plano: 'FAMILIA', status: 'CANCELADA', dataRenovacao: agora } });
    expect((await obterPlanoVigente(casa.casaId, prisma, agora)).plano.nome).toBe('INDIVIDUAL');
  });

  it('PENDENTE e EXPIRADA nunca contam', async () => {
    const casa = await montarCasa();
    await criarAssinaturaDeTeste(casa.casaId, casa.admin.usuario.id, 'FAMILIA', { status: 'PENDENTE' });
    await criarAssinaturaDeTeste(casa.casaId, casa.admin.usuario.id, 'BUSINESS', { status: 'EXPIRADA' });
    expect((await obterPlanoVigente(casa.casaId)).plano.nome).toBe('INDIVIDUAL');
  });

  it('não mistura assinaturas de outra Casa', async () => {
    const a = await montarCasa({ assinatura: 'BUSINESS' });
    const b = await montarCasa();
    expect((await obterPlanoVigente(a.casaId)).plano.nome).toBe('BUSINESS');
    expect((await obterPlanoVigente(b.casaId)).plano.nome).toBe('INDIVIDUAL');
  });
});

describe('obterCotaDaCasa', () => {
  it('traz membros, limites e armazenamento em bytes binários (0 sem fotos)', async () => {
    const casa = await montarCasa({ assinatura: 'FAMILIA' }); // ADMIN + EDITOR + LEITOR
    const cota = await obterCotaDaCasa(casa.casaId);
    expect(cota.membros).toEqual({ emUso: 3, limite: 6 });
    expect(cota.armazenamento).toEqual({ usadoBytes: 0, limiteBytes: 20 * BYTES_POR_GB });
  });

  it('soma Foto.tamanhoBytes só da própria Casa', async () => {
    const a = await montarCasa();
    const b = await montarCasa();
    await adicionarFoto(a.casaId, 1000);
    await adicionarFoto(a.casaId, 234);
    await adicionarFoto(b.casaId, 99_999);
    expect((await obterCotaDaCasa(a.casaId)).armazenamento.usadoBytes).toBe(1234);
  });
});

describe('verificarSeCabeNoPlano', () => {
  it('Casa de 3 membros não cabe em plano de 1 membro e cabe na Família', async () => {
    const casa = await montarCasa(); // 3 membros, sem assinatura
    expect((await verificarSeCabeNoPlano(casa.casaId, 'FAMILIA')).cabe).toBe(true);
    const r = avaliarEncaixe((await obterPlanoVigente(casa.casaId)).plano, 3, 0);
    expect(r.cabe).toBe(false);
    expect(r.violacoes).toEqual([{ limite: 'MEMBROS', atual: 3, maximo: 1 }]);
  });

  it('informa membros e armazenamento juntos quando ambos estouram', () => {
    const plano = { id: 1, nome: 'INDIVIDUAL' as const, preco: '0.00', limiteMembros: 1, limiteArmazenamentoGb: 1 };
    const r = avaliarEncaixe(plano, 2, BYTES_POR_GB + 1);
    expect(r.violacoes.map((v) => v.limite)).toEqual(['MEMBROS', 'ARMAZENAMENTO']);
    expect(avaliarEncaixe(plano, 1, BYTES_POR_GB).cabe).toBe(true); // limite exato cabe
  });

  it('aceita o uso informado (assinar como membro: Casa nova com 1 membro e 0 bytes)', async () => {
    const casa = await montarCasa({ editores: 8, leitores: 0 });
    expect((await verificarSeCabeNoPlano(casa.casaId, 'FAMILIA')).cabe).toBe(false);
    expect((await verificarSeCabeNoPlano(casa.casaId, 'FAMILIA', prisma, { membros: 1, usadoBytes: 0 })).cabe).toBe(true);
  });
});

describe('limites de membros e de armazenamento', () => {
  it('exigirVagaParaMembro lança LIMITE_MEMBROS no limite e passa com vaga', async () => {
    const cheia = await montarCasa({ editores: 0, leitores: 0 }); // Individual: 1/1
    await expect(exigirVagaParaMembro(cheia.casaId)).rejects.toMatchObject({
      status: 409,
      codigo: 'LIMITE_MEMBROS',
    });
    const comVaga = await montarCasa({ assinatura: 'FAMILIA' });
    await expect(exigirVagaParaMembro(comVaga.casaId)).resolves.toBeUndefined();
  });

  it('podeEnviarBytes / exigirCotaParaEnvio respeitam a cota do plano vigente', async () => {
    const casa = await montarCasa();
    await adicionarFoto(casa.casaId, BYTES_POR_GB - 100);
    expect(await podeEnviarBytes(casa.casaId, 100)).toBe(true);
    expect(await podeEnviarBytes(casa.casaId, 101)).toBe(false);
    await expect(exigirCotaParaEnvio(casa.casaId, 101)).rejects.toBeInstanceOf(HttpError);
    await expect(exigirCotaParaEnvio(casa.casaId, 101)).rejects.toMatchObject({ status: 409, codigo: 'COTA_EXCEDIDA' });
  });
});
