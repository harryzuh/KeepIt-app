import { vi } from 'vitest';
import { CHAVE_PERFIL } from '@/features/auth/hooks';
import type { ProdutoDetalhe, ProdutoResumo } from '@/features/produtos/tipos';
import { queryClient } from '@/lib/queryClient';
import { perfilExemplo } from './utils';

/** Prepara sessão e perfil com o papel desejado. */
export function entrarComo(papel: 'ADMIN' | 'EDITOR' | 'LEITOR') {
  localStorage.setItem('keepit.token', 't');
  queryClient.setQueryData(CHAVE_PERFIL, { ...perfilExemplo, papel });
}

export const resumo = (o: Partial<ProdutoResumo> = {}): ProdutoResumo => ({
  id: 21,
  nome: 'Cafeteira Elétrica',
  preco: '249.90',
  quantidade: 1,
  dataCompra: '2026-03-15',
  dataCadastro: '2026-11-15T16:00:00.000Z',
  tags: [{ id: 3, nome: 'Cozinha' }],
  fotoCapa: null,
  adicionadoPor: { id: 10, nome: 'Ana Souza' },
  ...o,
});

export const detalhe = (o: Partial<ProdutoDetalhe> = {}): ProdutoDetalhe => {
  const base: Partial<ProdutoResumo> = resumo();
  delete base.fotoCapa;
  return { ...(base as Omit<ProdutoResumo, 'fotoCapa'>), descricao: 'Preta, 15 xícaras', fotos: [], atualizadoEm: '2026-11-15T16:00:00.000Z', ...o };
};

export const pagina = <T,>(itens: T[], extra: Record<string, number> = {}) => ({
  itens,
  pagina: 1,
  limite: 20,
  total: itens.length,
  totalPaginas: itens.length ? 1 : 0,
  ...extra,
});

export const tagsExemplo = {
  itens: [
    { id: 3, nome: 'Cozinha', quantidadeProdutos: 4 },
    { id: 5, nome: 'Eletrônicos', quantidadeProdutos: 2 },
  ],
};

type Resp = { status?: number; corpo?: unknown };
type Tratador = Resp | ((consulta: URLSearchParams) => Resp);

/** fetch falso por "METODO /caminho" ignorando a query string (o tratador recebe a query). Registra as chamadas. */
export function mockarApi(rotas: Record<string, Tratador>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const [caminho, qs = ''] = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '').split('?');
    const r = rotas[`${init?.method ?? 'GET'} ${caminho}`];
    if (!r) return new Response(JSON.stringify({ error: 'NAO_ENCONTRADO', message: caminho }), { status: 404 });
    const { status = 200, corpo = {} } = typeof r === 'function' ? r(new URLSearchParams(qs)) : r;
    return new Response(status === 204 ? null : JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** "METODO /caminho?query" de cada chamada feita. */
export const chamadas = (f: ReturnType<typeof mockarApi>) =>
  f.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${String(u).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '')}`);

/** Corpos JSON enviados a uma rota ("POST /produtos"). */
export const corposEnviados = (f: ReturnType<typeof mockarApi>, rota: string) =>
  f.mock.calls
    .filter(([u, i]) => `${i?.method ?? 'GET'} ${String(u).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '').split('?')[0]}` === rota)
    .map(([, i]) => JSON.parse(String(i?.body)));

/** Bytes mínimos reconhecíveis como JPEG e PNG (assinatura real do arquivo). */
export const BYTES_JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
export const BYTES_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

export function arquivoDeTeste(nome: string, bytes: number[], tipo: string, tamanho = bytes.length) {
  const f = new File([new Uint8Array(bytes)], nome, { type: tipo });
  if (tamanho !== bytes.length) Object.defineProperty(f, 'size', { value: tamanho });
  return f;
}

export interface PutRegistrado {
  metodo: string;
  url: string;
  cabecalhos: Record<string, string>;
  corpo: unknown;
}

/** XMLHttpRequest falso para o PUT ao S3: responde com os status em ordem (padrão 200) e emite progresso. */
export function mockarPutS3(status: number[] = []) {
  const puts: PutRegistrado[] = [];
  let n = 0;
  class XhrFalso {
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 0;
    private reg: PutRegistrado = { metodo: '', url: '', cabecalhos: {}, corpo: null };
    open(metodo: string, url: string) {
      this.reg.metodo = metodo;
      this.reg.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.reg.cabecalhos[k] = v;
    }
    send(corpo: unknown) {
      this.reg.corpo = corpo;
      puts.push(this.reg);
      const st = status[n++] ?? 200;
      setTimeout(() => {
        if (st === 0) return this.onerror?.();
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
        this.status = st;
        this.onload?.();
      }, 0);
    }
  }
  vi.stubGlobal('XMLHttpRequest', XhrFalso);
  return puts;
}
