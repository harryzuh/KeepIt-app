import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { vi } from 'vitest';
import { queryClient } from '@/lib/queryClient';

/** Renderiza rotas em memória com o cliente do TanStack Query. */
export function renderizarRotas(rotas: RouteObject[], inicial = '/') {
  const router = createMemoryRouter(rotas, { initialEntries: [inicial] });
  const r = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, ...r };
}

export interface RespostaFalsa {
  status?: number;
  corpo?: unknown;
}

/** fetch falso: devolve as respostas na ordem; registra as chamadas. */
export function mockarFetch(...respostas: RespostaFalsa[]) {
  const fn = vi.fn();
  respostas.forEach((r) => {
    const status = r.status ?? 200;
    fn.mockResolvedValueOnce(
      new Response(status === 204 ? null : JSON.stringify(r.corpo ?? {}), { status, headers: { 'Content-Type': 'application/json' } }),
    );
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const perfilExemplo = {
  id: 1,
  nome: 'Ana Silva',
  email: 'ana.silva@email.com',
  criadoEm: '2026-11-15T17:00:00.000Z',
  casa: { id: 1, nome: 'Casa de Ana', totalMembros: 1 },
  papel: 'ADMIN',
  plano: { nome: 'INDIVIDUAL', preco: '0.00', limiteMembros: 1, limiteArmazenamentoGb: 1 },
  assinatura: null,
};

/** fetch falso por rota ("METODO /caminho"): cada rota devolve a resposta (ou uma função dela). Registra as chamadas. */
export function mockarRotas(rotas: Record<string, RespostaFalsa | (() => RespostaFalsa)>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const caminho = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '');
    const chave = `${init?.method ?? 'GET'} ${caminho}`;
    const r = rotas[chave];
    if (!r) return new Response(JSON.stringify({ error: 'NAO_ENCONTRADO', message: chave }), { status: 404 });
    const { status = 200, corpo = {} } = typeof r === 'function' ? r() : r;
    return new Response(status === 204 ? null : JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const planosExemplo = [
  { id: 1, nome: 'INDIVIDUAL', preco: '0.00', limiteMembros: 1, limiteArmazenamentoGb: 1 },
  { id: 2, nome: 'FAMILIA', preco: '19.90', limiteMembros: 6, limiteArmazenamentoGb: 20 },
  { id: 3, nome: 'BUSINESS', preco: '49.90', limiteMembros: 15, limiteArmazenamentoGb: 100 },
];
