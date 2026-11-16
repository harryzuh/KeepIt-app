import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { montarCasa } from './casa.js';
import { limparBanco } from './db.js';
import { criarFotoDeTeste, criarProdutoDeTeste, criarTagDeTeste } from './produtos.js';

beforeEach(limparBanco);

describe('helpers de produto, tag e foto + regras de schema do M3', () => {
  it('cria produto com tags e foto na Casa; a cota enxerga a foto', async () => {
    const casa = await montarCasa();
    const produto = await criarProdutoDeTeste(casa.casaId, { nome: 'Cafeteira', tags: ['Cozinha', 'cozinha', 'Garantia'] });
    await criarFotoDeTeste(produto.id, { tamanhoBytes: 1234 });
    const completo = await prisma.produto.findUniqueOrThrow({ where: { id: produto.id }, include: { tags: true, fotos: true } });
    expect(completo.tags).toHaveLength(2); // "Cozinha" e "cozinha" são a mesma tag
    expect(completo.fotos[0]?.tipo).toBe('JPEG');
    expect(completo.atualizadoEm).toBeInstanceOf(Date);
  });

  it('o banco recusa tag repetida na Casa sem diferenciar caixa, mas aceita em outra Casa', async () => {
    const a = await montarCasa();
    const b = await montarCasa();
    await prisma.tag.create({ data: { casaId: a.casaId, nome: 'Cozinha' } });
    await expect(prisma.tag.create({ data: { casaId: a.casaId, nome: 'cozinha' } })).rejects.toThrow();
    await expect(criarTagDeTeste(b.casaId, 'cozinha')).resolves.toMatchObject({ nome: 'cozinha' });
  });

  it('a chave da foto é única e a foto sai junto com o produto', async () => {
    const casa = await montarCasa();
    const p = await criarProdutoDeTeste(casa.casaId);
    await criarFotoDeTeste(p.id, { chave: 'k1' });
    await expect(criarFotoDeTeste(p.id, { chave: 'k1', ordem: 1 })).rejects.toThrow();
    await prisma.produto.delete({ where: { id: p.id } });
    expect(await prisma.foto.count()).toBe(0);
  });
});
