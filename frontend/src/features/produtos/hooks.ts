import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CHAVE_ASSINATURA, useAssinaturaAtual } from '@/features/assinatura/hooks';
import { CHAVE_PERFIL, useUsuarioAtual } from '@/features/auth/hooks';
import { CHAVE_ESTATISTICAS } from '@/features/estatisticas/hooks';
import { ApiError } from '@/lib/api';
import { produtosApi } from './api';
import type { ConsultaProdutos } from './tipos';

export const CHAVE_PRODUTOS = ['produtos'] as const;
export const CHAVE_TAGS = ['tags'] as const;

export const useTags = () => useQuery({ queryKey: CHAVE_TAGS, queryFn: produtosApi.tags });

/** Lista paginada (tela 06) e recentes da tela 05 (`limite: 5`). Mantém a página anterior na tela enquanto busca a nova. */
export const useProdutos = (consulta: ConsultaProdutos) =>
  useQuery({
    queryKey: [...CHAVE_PRODUTOS, 'lista', consulta],
    queryFn: () => produtosApi.listar(consulta),
    placeholderData: keepPreviousData,
  });

export const useProduto = (id: number) =>
  useQuery({ queryKey: [...CHAVE_PRODUTOS, 'detalhe', id], queryFn: () => produtosApi.detalhe(id), enabled: Number.isInteger(id) && id > 0 });

/** Histórico do produto (RF11), "carregar mais" por página. */
export const useHistorico = (id: number) =>
  useInfiniteQuery({
    queryKey: [...CHAVE_PRODUTOS, 'historico', id],
    queryFn: ({ pageParam }) => produtosApi.historico(id, pageParam),
    initialPageParam: 1,
    getNextPageParam: (p) => (p.pagina < p.totalPaginas ? p.pagina + 1 : undefined),
  });

/** Lista, detalhe, histórico e contagem das tags dependem dos produtos. */
function useAposMudarProdutos() {
  const qc = useQueryClient();
  return (comUso = false) => {
    qc.invalidateQueries({ queryKey: CHAVE_PRODUTOS });
    qc.invalidateQueries({ queryKey: CHAVE_TAGS });
    // Valor total, contagens, maior gasto e valor por tag (M4, RNF07); fotos mudam o uso de armazenamento do resumo
    qc.invalidateQueries({ queryKey: CHAVE_ESTATISTICAS });
    if (comUso) {
      // Fotos removidas liberam armazenamento (RF39): uso da assinatura e perfil ficam velhos.
      qc.invalidateQueries({ queryKey: CHAVE_ASSINATURA });
      qc.invalidateQueries({ queryKey: CHAVE_PERFIL });
    }
  };
}

export function useCriarTag() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: produtosApi.criarTag, onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHAVE_ESTATISTICAS }); // `Resumo.tags` conta tags sem produto
      return qc.invalidateQueries({ queryKey: CHAVE_TAGS });
    },
  });
}

export function useCriarProduto() {
  const apos = useAposMudarProdutos();
  // Com fotos (ou soma), o uso de armazenamento pode ter mudado
  return useMutation({ mutationFn: produtosApi.criar, onSuccess: (_r, v) => apos(!!v.fotos?.length) });
}

export function useEditarProduto() {
  const apos = useAposMudarProdutos();
  return useMutation({ mutationFn: produtosApi.editar, onSuccess: (_r, v) => apos(v.fotos !== undefined) });
}

/** Segundo clique ou produto já excluído (404) conta como sucesso silencioso (contrato 3.8). */
export function useExcluirProduto() {
  const apos = useAposMudarProdutos();
  return useMutation({
    mutationFn: async (id: number) => {
      try {
        await produtosApi.excluir(id);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
    },
    onSuccess: () => apos(true),
  });
}

/**
 * Uso do armazenamento da Casa (RF39). Fonte: `uso` do GET /me (como diz o contrato); se o back-end não
 * devolver, o ADMIN lê da assinatura atual; EDITOR sem essa fonte vê só o limite do plano (`usadoBytes` nulo).
 */
export function useUsoArmazenamento(): { usadoBytes: number | null; limiteBytes: number } | null {
  const { data: u } = useUsuarioAtual();
  const assinatura = useAssinaturaAtual();
  if (!u) return null;
  const doPerfil = u.uso?.armazenamento ?? assinatura.data?.uso.armazenamento;
  if (doPerfil) return doPerfil;
  return { usadoBytes: null, limiteBytes: u.plano.limiteArmazenamentoGb * 1024 ** 3 };
}
