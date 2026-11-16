import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { montarCasa } from './casa.js';
import { criarUsuarioComCasa, limparBanco } from './db.js';

beforeEach(limparBanco);
afterAll(() => prisma.$disconnect());

describe('montarCasa e invariantes do schema (ADR 0002, D8)', () => {
  it('monta ADMIN + N editores e leitores com token e assinatura opcional', async () => {
    const casa = await montarCasa({ editores: 2, leitores: 3, assinatura: 'BUSINESS' });
    expect(casa.membros).toHaveLength(6);
    expect(casa.editores).toHaveLength(2);
    expect(casa.leitores).toHaveLength(3);
    expect(await prisma.assinatura.count({ where: { casaId: casa.casaId, status: 'ATIVA' } })).toBe(1);
  });

  it('o banco recusa um segundo ADMIN na mesma Casa', async () => {
    const casa = await montarCasa();
    await expect(criarUsuarioComCasa({ papel: 'ADMIN', casaId: casa.casaId })).rejects.toThrow();
  });

  it('o banco recusa duas assinaturas vigentes na mesma Casa, mas aceita várias EXPIRADAS', async () => {
    const { casaId, admin } = await montarCasa({ assinatura: 'FAMILIA' });
    const plano = await prisma.plano.findUniqueOrThrow({ where: { nome: 'BUSINESS' } });
    const base = { casaId, planoId: plano.id, titularId: admin.usuario.id, dataRenovacao: new Date() };
    await expect(prisma.assinatura.create({ data: { ...base, status: 'CANCELADA' } })).rejects.toThrow();
    await prisma.assinatura.createMany({ data: [{ ...base, status: 'EXPIRADA' }, { ...base, status: 'EXPIRADA' }] });
  });
});
