import type { Estatisticas, Resumo } from '@/features/estatisticas/tipos';

export const resumoExemplo = (o: Partial<Resumo> = {}): Resumo => ({
  valorTotal: '5754.60',
  produtos: 3,
  unidades: 45,
  tags: 4,
  membros: { emUso: 3, limite: 6 },
  armazenamento: { usadoBytes: 482113, limiteBytes: 21474836480 },
  plano: { nome: 'FAMILIA' },
  renovacao: { status: 'ATIVA', data: '2026-12-15T17:00:00.000Z' },
  ...o,
});

export const resumoVazio = resumoExemplo({
  valorTotal: '0.00',
  produtos: 0,
  unidades: 0,
  tags: 0,
  membros: { emUso: 1, limite: 1 },
  armazenamento: { usadoBytes: 0, limiteBytes: 1073741824 },
  plano: { nome: 'INDIVIDUAL' },
  renovacao: null,
});

export const completaExemplo = (o: Partial<Estatisticas> = {}): Estatisticas => ({
  valorTotal: '5754.60',
  produtos: 3,
  unidades: 45,
  valorMedio: '1918.20',
  maiorGasto: { id: 31, nome: 'Notebook 14 polegadas', preco: '4599.00', quantidade: 1, valor: '4599.00', dataCompra: '2026-10-16' },
  tagMaisComprada: { id: 9, nome: 'Utilidades', unidades: 40, produtos: 1 },
  valorPorTag: [
    { id: 2, nome: 'Eletrônicos', valor: '4599.00', unidades: 1, produtos: 1 },
    { id: 3, nome: 'Garantia', valor: '4599.00', unidades: 1, produtos: 1 },
    { id: 9, nome: 'Utilidades', valor: '996.00', unidades: 40, produtos: 1 },
  ],
  totalTagsComProduto: 3,
  semTag: { valor: '159.60', unidades: 4, produtos: 1 },
  maisAntigos: [
    { id: 31, nome: 'Notebook 14 polegadas', preco: '4599.00', quantidade: 1, valor: '4599.00', dataCompra: '2026-10-16' },
    { id: 32, nome: 'Pilhas AA (cartela)', preco: '24.90', quantidade: 40, valor: '996.00', dataCompra: '2026-11-05' },
    { id: 33, nome: 'Caixa organizadora', preco: '39.90', quantidade: 4, valor: '159.60', dataCompra: '2026-11-07' },
  ],
  ...o,
});

export const completaVazia: Estatisticas = {
  valorTotal: '0.00',
  produtos: 0,
  unidades: 0,
  valorMedio: '0.00',
  maiorGasto: null,
  tagMaisComprada: null,
  valorPorTag: [],
  totalTagsComProduto: 0,
  semTag: null,
  maisAntigos: [],
};
