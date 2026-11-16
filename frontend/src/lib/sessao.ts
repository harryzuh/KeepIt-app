import { useSyncExternalStore } from 'react';
import { queryClient } from './queryClient';

/**
 * Sessão do usuário. O token fica em localStorage (`keepit.token`) e é lido a
 * cada requisição (docs/api/m1-auth.md, seção 1.1).
 */
const CHAVE = 'keepit.token';

export interface Saida {
  /** Para onde as rotas protegidas mandam o usuário quando não há token. */
  destino: string;
  aviso?: string;
}

let saida: Saida = { destino: '/entrar' };
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

function obterToken(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

export const sessao = {
  obterToken,
  definirToken(token: string) {
    try {
      localStorage.setItem(CHAVE, token);
    } catch {
      /* armazenamento indisponível: a sessão vale só até recarregar */
    }
    saida = { destino: '/entrar' };
    avisar();
  },
  /** Apaga o token, limpa o cache e define para onde ir (e o aviso a exibir). */
  encerrar(nova: Saida = { destino: '/entrar' }) {
    try {
      localStorage.removeItem(CHAVE);
    } catch {
      /* ignorado */
    }
    saida = nova;
    queryClient.clear();
    avisar();
  },
  obterSaida: () => saida,
  assinar(f: () => void) {
    ouvintes.add(f);
    const aoMudarOutraAba = (e: StorageEvent) => {
      if (e.key === CHAVE || e.key === null) {
        // Token removido ou trocado em outra aba: descarta o cache da conta anterior.
        if (e.newValue !== e.oldValue) queryClient.clear();
        f();
      }
    };
    window.addEventListener('storage', aoMudarOutraAba);
    return () => {
      ouvintes.delete(f);
      window.removeEventListener('storage', aoMudarOutraAba);
    };
  },
};

export const useToken = () => useSyncExternalStore(sessao.assinar, sessao.obterToken);
export const useSaida = () => useSyncExternalStore(sessao.assinar, sessao.obterSaida);
