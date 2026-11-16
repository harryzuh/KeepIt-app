// Tipos do contrato docs/api/m1-auth.md (seção 2)
export type Papel = 'ADMIN' | 'EDITOR' | 'LEITOR';
export type NomePlano = 'INDIVIDUAL' | 'FAMILIA' | 'BUSINESS';

export interface Perfil {
  id: number;
  nome: string;
  email: string;
  criadoEm: string;
  casa: { id: number; nome: string; totalMembros: number };
  papel: Papel;
  plano: { nome: NomePlano; preco: string; limiteMembros: number; limiteArmazenamentoGb: number };
  /** Assinatura vigente da Casa (nulo no Individual). docs/api/m5-assinatura.md, seção 5. */
  assinatura: { status: 'ATIVA' | 'CANCELADA'; dataRenovacao: string } | null;
  /** Uso da Casa. O contrato do M3 diz que o /me traz isto, mas o back-end ainda não devolve: tratar como opcional. */
  uso?: { armazenamento: { usadoBytes: number; limiteBytes: number } };
}

export interface RespostaSessao {
  token: string;
  usuario: Perfil;
}
