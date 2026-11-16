import { QueryClient } from '@tanstack/react-query';

/** Cliente único do TanStack Query (limpo ao encerrar a sessão). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Erros 4xx são definitivos; só repete em falha de rede/servidor.
      retry: (tentativas, erro) => {
        const status = (erro as { status?: number }).status ?? 0;
        return (status === 0 || status >= 500) && tentativas < 1;
      },
      refetchOnWindowFocus: true, // atualização em segundo plano (RNF07)
      staleTime: 30_000,
    },
    mutations: { retry: false },
  },
});
