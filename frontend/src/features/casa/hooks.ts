import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CHAVE_ASSINATURA } from '@/features/assinatura/hooks';
import { CHAVE_PERFIL } from '@/features/auth/hooks';
import { CHAVE_ESTATISTICAS } from '@/features/estatisticas/hooks';
import { CHAVE_PRODUTOS, CHAVE_TAGS } from '@/features/produtos/hooks';
import { casaApi } from './api';

export const CHAVE_MEMBROS = ['casa', 'membros'] as const;

export const useMembros = () => useQuery({ queryKey: CHAVE_MEMBROS, queryFn: casaApi.membros });

/** Membros, papel ou nome mudaram: a lista, o perfil (totalMembros, casa.nome) e o uso do plano ficam velhos. */
function useAposMudarCasa() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: CHAVE_PERFIL });
    qc.invalidateQueries({ queryKey: CHAVE_ASSINATURA });
    qc.invalidateQueries({ queryKey: CHAVE_ESTATISTICAS }); // membros em uso no resumo
    return qc.invalidateQueries({ queryKey: CHAVE_MEMBROS });
  };
}

export function useAdicionarMembro() {
  const apos = useAposMudarCasa();
  return useMutation({ mutationFn: casaApi.adicionar, onSuccess: apos });
}

export function useAlterarPapel() {
  const apos = useAposMudarCasa();
  return useMutation({ mutationFn: casaApi.alterarPapel, onSuccess: apos });
}

export function useRemoverMembro() {
  const apos = useAposMudarCasa();
  return useMutation({ mutationFn: casaApi.remover, onSuccess: apos });
}

export function useRenomearCasa() {
  const apos = useAposMudarCasa();
  return useMutation({ mutationFn: casaApi.renomear, onSuccess: apos });
}

/** Saída voluntária (EDITOR/LEITOR): o perfil da resposta substitui /me e o cache da Casa antiga é descartado. */
export function useSairDaCasa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: casaApi.sair,
    onSuccess: ({ perfil }) => {
      qc.setQueryData(CHAVE_PERFIL, perfil);
      qc.removeQueries({ queryKey: CHAVE_MEMBROS });
      qc.removeQueries({ queryKey: CHAVE_ASSINATURA });
      qc.removeQueries({ queryKey: CHAVE_ESTATISTICAS });
      qc.removeQueries({ queryKey: CHAVE_PRODUTOS });
      qc.removeQueries({ queryKey: CHAVE_TAGS });
    },
  });
}
