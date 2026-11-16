import { api } from '@/lib/api';
import type {
  AlteracaoProduto,
  ConsultaProdutos,
  EventoHistorico,
  NovoProduto,
  PedidoUploadUrl,
  Pagina,
  ProdutoDetalhe,
  ProdutoResumo,
  RespostaCriar,
  RespostaUploadUrl,
  Tag,
  TagComContagem,
} from './tipos';

function query(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

// Uma função por rota de docs/api/m3-produtos.md
export const produtosApi = {
  tags: () => api<{ itens: TagComContagem[] }>('/tags'),
  criarTag: (nome: string) => api<Tag>('/tags', { method: 'POST', body: { nome } }),
  listar: (c: ConsultaProdutos) =>
    api<Pagina<ProdutoResumo>>(`/produtos${query({ busca: c.busca?.trim(), tagId: c.tagId, pagina: c.pagina && c.pagina > 1 ? c.pagina : undefined, limite: c.limite, ordem: c.ordem === 'nome' ? 'nome' : undefined })}`),
  uploadUrl: (p: PedidoUploadUrl) => api<RespostaUploadUrl>('/produtos/fotos/upload-url', { method: 'POST', body: p }),
  detalhe: (id: number) => api<ProdutoDetalhe>(`/produtos/${id}`),
  criar: (d: NovoProduto) => api<RespostaCriar>('/produtos', { method: 'POST', body: d }),
  editar: ({ id, ...d }: AlteracaoProduto & { id: number }) => api<ProdutoDetalhe>(`/produtos/${id}`, { method: 'PATCH', body: d }),
  excluir: (id: number) => api<void>(`/produtos/${id}`, { method: 'DELETE' }),
  historico: (id: number, pagina: number) => api<Pagina<EventoHistorico>>(`/produtos/${id}/historico${query({ pagina, limite: 20 })}`),
};
