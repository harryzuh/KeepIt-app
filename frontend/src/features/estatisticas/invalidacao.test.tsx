import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCriarTag, useEditarProduto, useExcluirProduto } from '@/features/produtos/hooks';
import { mockarApi } from '@/test/produtos';
import { queryClient } from '@/lib/queryClient';
import { CHAVE_ESTATISTICAS } from './hooks';

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

function semear() {
  queryClient.setQueryData([...CHAVE_ESTATISTICAS, 'resumo'], { valorTotal: '1.00' });
  queryClient.setQueryData([...CHAVE_ESTATISTICAS, 'completa'], { valorTotal: '1.00' });
}
const velhos = () => [
  queryClient.getQueryState([...CHAVE_ESTATISTICAS, 'resumo'])?.isInvalidated,
  queryClient.getQueryState([...CHAVE_ESTATISTICAS, 'completa'])?.isInvalidated,
];

describe('invalidação do cache de estatísticas (RNF07)', () => {
  it('excluir produto invalida resumo e estatísticas completas', async () => {
    mockarApi({ 'DELETE /produtos/7': { status: 204 } });
    semear();
    const { result } = renderHook(() => useExcluirProduto(), { wrapper });
    await act(() => result.current.mutateAsync(7));
    await waitFor(() => expect(velhos()).toEqual([true, true]));
  });

  it('editar produto (inclui somar por duplicidade e foto) invalida o prefixo', async () => {
    mockarApi({ 'PATCH /produtos/7': { corpo: { id: 7 } } });
    semear();
    const { result } = renderHook(() => useEditarProduto(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 7, quantidade: 2 }));
    await waitFor(() => expect(velhos()).toEqual([true, true]));
  });

  it('criar tag invalida o prefixo', async () => {
    mockarApi({ 'POST /tags': { status: 201, corpo: { id: 1, nome: 'Jardim' } } });
    semear();
    const { result } = renderHook(() => useCriarTag(), { wrapper });
    await act(() => result.current.mutateAsync('Jardim'));
    await waitFor(() => expect(velhos()).toEqual([true, true]));
  });
});
