import { useQuery } from '@tanstack/react-query';
import { estatisticasApi } from './api';

/** Prefixo único: invalidá-lo atualiza o resumo (telas 05 e 17) e a tela 10 (contrato, seção 1). */
export const CHAVE_ESTATISTICAS = ['estatisticas'] as const;

const STALE_MS = 30_000;

/** Indicadores do Início (telas 05 e 17). */
export const useResumo = (opcoes: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: [...CHAVE_ESTATISTICAS, 'resumo'], queryFn: estatisticasApi.resumo, staleTime: STALE_MS, ...opcoes });

/** Estatísticas completas (tela 10). No desktop o Início também usa maior gasto e valor médio daqui. */
export const useEstatisticas = (opcoes: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: [...CHAVE_ESTATISTICAS, 'completa'], queryFn: estatisticasApi.completa, staleTime: STALE_MS, ...opcoes });
