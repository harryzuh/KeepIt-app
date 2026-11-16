import { api } from '@/lib/api';
import type { Perfil } from '@/features/auth/tipos';
import type { MembroDaCasa, PapelAtribuivel, RespostaAdicionar, RespostaMembros } from './tipos';

// Uma função por rota de docs/api/m2-casa.md
export const casaApi = {
  membros: () => api<RespostaMembros>('/casa/membros'),
  adicionar: (d: { email: string; papel: PapelAtribuivel }) =>
    api<RespostaAdicionar>('/casa/membros', { method: 'POST', body: d }),
  alterarPapel: ({ usuarioId, papel }: { usuarioId: number; papel: PapelAtribuivel }) =>
    api<{ membro: MembroDaCasa }>(`/casa/membros/${usuarioId}`, { method: 'PATCH', body: { papel } }),
  remover: (usuarioId: number) => api<void>(`/casa/membros/${usuarioId}`, { method: 'DELETE' }),
  sair: () => api<{ perfil: Perfil }>('/casa/sair', { method: 'POST' }),
  renomear: (nome: string) => api<{ casa: { id: number; nome: string } }>('/casa', { method: 'PATCH', body: { nome } }),
};
