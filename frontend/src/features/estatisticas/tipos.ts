// Tipos do contrato docs/api/m4-estatisticas.md (seção 2)

/** String decimal "12345.67" (sempre 2 casas). Nunca converter para Number. */
export type Dinheiro = string;
/** Só data, "2026-03-15". */
export type DataCivil = string;

export interface ProdutoValor {
  id: number;
  nome: string;
  preco: Dinheiro;
  quantidade: number;
  valor: Dinheiro;
  dataCompra: DataCivil;
}

export interface LinhaTag {
  id: number;
  nome: string;
  valor: Dinheiro;
  unidades: number;
  produtos: number;
}

export interface Resumo {
  valorTotal: Dinheiro;
  produtos: number;
  unidades: number;
  tags: number;
  membros: { emUso: number; limite: number };
  armazenamento: { usadoBytes: number; limiteBytes: number };
  plano: { nome: 'INDIVIDUAL' | 'FAMILIA' | 'BUSINESS' };
  /** null = plano Individual. */
  renovacao: { status: 'ATIVA' | 'CANCELADA'; data: string } | null;
}

export interface Estatisticas {
  valorTotal: Dinheiro;
  produtos: number;
  unidades: number;
  valorMedio: Dinheiro;
  maiorGasto: ProdutoValor | null;
  tagMaisComprada: { id: number; nome: string; unidades: number; produtos: number } | null;
  valorPorTag: LinhaTag[];
  totalTagsComProduto: number;
  semTag: { valor: Dinheiro; unidades: number; produtos: number } | null;
  maisAntigos: ProdutoValor[];
}
