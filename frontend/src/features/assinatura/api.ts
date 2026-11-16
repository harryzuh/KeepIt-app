import { api } from '@/lib/api';
import type {
  AssinaturaAtual,
  CorpoAssinar,
  DadosCartao,
  MetodoPagamento,
  RespostaAssinar,
  RespostaAssinaturaAtual,
  RespostaPlanos,
} from './tipos';

// Uma função por rota de docs/api/m5-assinatura.md
export const assinaturaApi = {
  planos: () => api<RespostaPlanos>('/planos'),
  metodo: () => api<{ metodo: MetodoPagamento | null }>('/pagamento/metodo'),
  salvarMetodo: (d: DadosCartao) => api<{ metodo: MetodoPagamento }>('/pagamento/metodo', { method: 'PUT', body: d }),
  assinar: (d: CorpoAssinar) => api<RespostaAssinar>('/assinaturas', { method: 'POST', body: d }),
  atual: () => api<RespostaAssinaturaAtual>('/assinaturas/atual'),
  cancelar: (motivo?: string) =>
    api<{ assinatura: AssinaturaAtual }>('/assinaturas/atual/cancelar', { method: 'POST', body: motivo ? { motivo } : {} }),
  reativar: () => api<{ assinatura: AssinaturaAtual }>('/assinaturas/atual/reativar', { method: 'POST' }),
};
