import type { NomePlano } from '@prisma/client';

/** Catálogo oficial dos planos (ADR 0001). Usado pelo seed e pelos testes. */
export const PLANOS_PADRAO: ReadonlyArray<{
  nome: NomePlano;
  preco: string;
  limiteMembros: number;
  limiteArmazenamentoGb: number;
}> = [
  { nome: 'INDIVIDUAL', preco: '0.00', limiteMembros: 1, limiteArmazenamentoGb: 1 },
  { nome: 'FAMILIA', preco: '19.90', limiteMembros: 6, limiteArmazenamentoGb: 20 },
  { nome: 'BUSINESS', preco: '49.90', limiteMembros: 15, limiteArmazenamentoGb: 100 },
];
