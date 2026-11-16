import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CHAVE_PERFIL, useUsuarioAtual } from '@/features/auth/hooks';
import { CHAVE_ESTATISTICAS } from '@/features/estatisticas/hooks';
import { assinaturaApi } from './api';

export const CHAVE_PLANOS = ['planos'] as const;
export const CHAVE_METODO = ['pagamento', 'metodo'] as const;
export const CHAVE_ASSINATURA = ['assinatura', 'atual'] as const;

export const usePlanos = () => useQuery({ queryKey: CHAVE_PLANOS, queryFn: assinaturaApi.planos });

export const useMetodoPagamento = () => useQuery({ queryKey: CHAVE_METODO, queryFn: assinaturaApi.metodo });

/** Só o ADMIN consulta a assinatura atual (EDITOR e LEITOR recebem 403). */
export function useAssinaturaAtual() {
  const { data: u } = useUsuarioAtual();
  return useQuery({ queryKey: CHAVE_ASSINATURA, queryFn: assinaturaApi.atual, enabled: u?.papel === 'ADMIN' });
}

export function useSalvarMetodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: assinaturaApi.salvarMetodo,
    onSuccess: (r) => {
      qc.setQueryData(CHAVE_METODO, r);
      qc.invalidateQueries({ queryKey: CHAVE_ASSINATURA });
    },
  });
}

/**
 * Assinar ou trocar de plano. Substitui o perfil pelo devolvido; se a Casa mudou
 * (EDITOR/LEITOR que assina), limpa o cache inteiro (docs/api/m5-assinatura.md, 3.4).
 */
export function useAssinar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: assinaturaApi.assinar,
    onSuccess: ({ perfil }) => {
      const anterior = qc.getQueryData<{ casa: { id: number } }>(CHAVE_PERFIL);
      if (!anterior || anterior.casa.id !== perfil.casa.id) qc.clear();
      qc.setQueryData(CHAVE_PERFIL, perfil);
      qc.invalidateQueries({ queryKey: CHAVE_PLANOS });
      qc.invalidateQueries({ queryKey: CHAVE_ESTATISTICAS }); // plano, membros, limites e renovação do resumo
      qc.invalidateQueries({ queryKey: CHAVE_ASSINATURA });
    },
  });
}

function useMudarAssinatura(fn: (motivo?: string) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHAVE_PERFIL });
      qc.invalidateQueries({ queryKey: CHAVE_PLANOS });
      qc.invalidateQueries({ queryKey: CHAVE_ESTATISTICAS });
      return qc.invalidateQueries({ queryKey: CHAVE_ASSINATURA });
    },
  });
}

export const useCancelarAssinatura = () => useMudarAssinatura((motivo) => assinaturaApi.cancelar(motivo));
export const useReativarAssinatura = () => useMudarAssinatura(() => assinaturaApi.reativar());
