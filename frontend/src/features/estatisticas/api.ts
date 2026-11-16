import { api } from '@/lib/api';
import type { Estatisticas, Resumo } from './tipos';

// Uma função por rota de docs/api/m4-estatisticas.md (sem entrada: a Casa vem do token)
export const estatisticasApi = {
  resumo: () => api<Resumo>('/estatisticas/resumo'),
  completa: () => api<Estatisticas>('/estatisticas'),
};
