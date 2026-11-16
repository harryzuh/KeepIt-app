// Tipos do contrato docs/api/m5-assinatura.md (seção 2)
import type { Perfil } from '@/features/auth/tipos';

export type NomePlano = 'INDIVIDUAL' | 'FAMILIA' | 'BUSINESS';
export type StatusAssinatura = 'ATIVA' | 'CANCELADA';
export type MarcaCartao = 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO' | 'OUTRA';

export interface PlanoDetalhe {
  id: number;
  nome: NomePlano;
  preco: string;
  limiteMembros: number;
  limiteArmazenamentoGb: number;
}

export interface AssinaturaAtual {
  id: number;
  status: StatusAssinatura;
  plano: PlanoDetalhe;
  dataInicio: string;
  dataRenovacao: string;
  dataCancelamento: string | null;
  renovaAutomaticamente: boolean;
  podeReativar: boolean;
}

export interface MetodoPagamento {
  marca: MarcaCartao;
  ultimos4: string;
  atualizadoEm: string;
}

export interface UsoDaCasa {
  membros: { emUso: number; limite: number };
  armazenamento: { usadoBytes: number; limiteBytes: number };
}

export interface RespostaPlanos {
  planos: PlanoDetalhe[];
  planoAtual: NomePlano;
  assinatura: { status: StatusAssinatura; dataRenovacao: string } | null;
  /** false = planos pagos desativados (produção sem gateway): a tela mostra os planos, mas não deixa contratar. */
  contratacaoDisponivel?: boolean;
}

export interface RespostaAssinaturaAtual {
  assinatura: AssinaturaAtual | null;
  planoAtual: PlanoDetalhe;
  uso: UsoDaCasa;
  metodoPagamento: MetodoPagamento | null;
}

/** Contrato 3.3: só número e validade; nome do titular e CVV não são coletados. */
export interface DadosCartao {
  numero: string;
  validade: string;
}

export type PlanoContratavel = Exclude<NomePlano, 'INDIVIDUAL'>;

export interface CorpoAssinar {
  plano: PlanoContratavel;
  confirmaSaidaDaCasa?: boolean;
}

export interface RespostaAssinar {
  assinatura: AssinaturaAtual;
  perfil: Perfil;
}
