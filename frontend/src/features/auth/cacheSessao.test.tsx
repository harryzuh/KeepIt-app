import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useSairDaCasa } from '@/features/casa/hooks';
import { CHAVE_PRODUTOS, CHAVE_TAGS } from '@/features/produtos/hooks';
import { CHAVE_ESTATISTICAS } from '@/features/estatisticas/hooks';
import { mockarApi } from '@/test/produtos';
import { mockarFetch, perfilExemplo } from '@/test/utils';
import { queryClient } from '@/lib/queryClient';
import { sessao } from '@/lib/sessao';
import { CHAVE_PERFIL, useLogin } from './hooks';

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

function semearDadosDeA() {
  queryClient.setQueryData([...CHAVE_ESTATISTICAS, 'resumo'], { valorTotal: '99.00' });
  queryClient.setQueryData([...CHAVE_PRODUTOS, 'lista', {}], { pages: [] });
  queryClient.setQueryData(CHAVE_TAGS, [{ id: 1, nome: 'A' }]);
}
const vazio = () => queryClient.getQueryCache().findAll().length === 0;

describe('cache não vaza entre contas (F-11)', () => {
  it('login esvazia o cache da conta anterior', async () => {
    semearDadosDeA();
    mockarFetch({ corpo: { token: 'tB', usuario: perfilExemplo } });
    const { result } = renderHook(() => useLogin(), { wrapper });
    await act(() => result.current.mutateAsync({ email: 'b@x.com', senha: 'senha12345' }));
    expect(queryClient.getQueryData([...CHAVE_ESTATISTICAS, 'resumo'])).toBeUndefined();
    expect(queryClient.getQueryData(CHAVE_TAGS)).toBeUndefined();
    expect(queryClient.getQueryData(CHAVE_PERFIL)).toBeTruthy();
  });

  it('logout em outra aba (evento storage) esvazia o cache', () => {
    sessao.definirToken('tA');
    const desassinar = sessao.assinar(() => {});
    semearDadosDeA();
    window.dispatchEvent(new StorageEvent('storage', { key: 'keepit.token', oldValue: 'tA', newValue: null }));
    expect(vazio()).toBe(true);
    desassinar();
  });

  it('troca de token em outra aba esvazia o cache; evento de outra chave não', () => {
    const desassinar = sessao.assinar(() => {});
    semearDadosDeA();
    window.dispatchEvent(new StorageEvent('storage', { key: 'outra', oldValue: 'a', newValue: 'b' }));
    expect(vazio()).toBe(false);
    window.dispatchEvent(new StorageEvent('storage', { key: 'keepit.token', oldValue: 'tA', newValue: 'tB' }));
    expect(vazio()).toBe(true);
    desassinar();
  });

  it('sair da Casa descarta produtos, tags e estatísticas da Casa antiga', async () => {
    semearDadosDeA();
    mockarApi({ 'POST /casa/sair': { corpo: { perfil: perfilExemplo } } });
    const { result } = renderHook(() => useSairDaCasa(), { wrapper });
    await act(() => result.current.mutateAsync(undefined as never));
    await waitFor(() => expect(queryClient.getQueryData(CHAVE_TAGS)).toBeUndefined());
    expect(queryClient.getQueryData([...CHAVE_ESTATISTICAS, 'resumo'])).toBeUndefined();
    expect(queryClient.getQueryCache().findAll({ queryKey: CHAVE_PRODUTOS })).toHaveLength(0);
  });
});
