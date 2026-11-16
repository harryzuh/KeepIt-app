// Tipos do contrato docs/api/m2-casa.md (seção 2)
import type { Papel } from '@/features/auth/tipos';
import type { PlanoDetalhe, StatusAssinatura } from '@/features/assinatura/tipos';

export type PapelAtribuivel = Exclude<Papel, 'ADMIN'>;

export interface MembroDaCasa {
  usuarioId: number;
  nome: string;
  /** Só o ADMIN recebe o e-mail dos membros (minimização, LGPD); EDITOR e LEITOR não. */
  email?: string;
  papel: Papel;
  entrouEm: string;
}

export interface RespostaMembros {
  casa: { id: number; nome: string };
  plano: PlanoDetalhe;
  assinatura: { status: StatusAssinatura; dataRenovacao: string } | null;
  limiteMembros: number;
  membrosEmUso: number;
  membros: MembroDaCasa[];
}

export interface RespostaAdicionar {
  membro: MembroDaCasa;
  membrosEmUso: number;
  limiteMembros: number;
}
