import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sessao, useToken } from '@/lib/sessao';
import { authApi } from './api';
import type { RespostaSessao } from './tipos';

export const CHAVE_PERFIL = ['me'] as const;

/** Perfil do usuário logado (GET /me). Só consulta com token. */
export function useUsuarioAtual() {
  const token = useToken();
  return useQuery({ queryKey: CHAVE_PERFIL, queryFn: authApi.perfil, enabled: !!token });
}

/** Guarda o token e já deixa o perfil em cache (evita novo GET /me). */
function useIniciarSessao() {
  const qc = useQueryClient();
  return (r: RespostaSessao) => {
    qc.clear(); // nada da conta ou Casa anterior pode sobrar em memória
    qc.setQueryData(CHAVE_PERFIL, r.usuario);
    sessao.definirToken(r.token);
  };
}

export function useLogin() {
  const iniciar = useIniciarSessao();
  return useMutation({ mutationFn: authApi.login, onSuccess: iniciar });
}

export function useCadastro() {
  const iniciar = useIniciarSessao();
  return useMutation({ mutationFn: authApi.cadastro, onSuccess: iniciar });
}

export const useRecuperarSenha = () => useMutation({ mutationFn: authApi.recuperarSenha });
export const useRedefinirSenha = () => useMutation({ mutationFn: authApi.redefinirSenha });

/** Só apaga o token local depois do 204 (história 1.4, critério 5). */
export function useLogout() {
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => sessao.encerrar({ destino: '/', aviso: 'Sessão encerrada.' }),
  });
}

export function useAtualizarNome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.atualizarNome,
    onSuccess: (perfil) => qc.setQueryData(CHAVE_PERFIL, perfil),
  });
}

export const useSolicitarEmail = () => useMutation({ mutationFn: authApi.solicitarEmail });

export function useConfirmarEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.confirmarEmail,
    onSuccess: ({ token, ...perfil }) => {
      qc.setQueryData(CHAVE_PERFIL, perfil);
      sessao.definirToken(token); // o token antigo deixa de valer após a troca
    },
  });
}

/** A API devolve um token novo: substitui o guardado e mantém a sessão. */
export function useAlterarSenha() {
  return useMutation({
    mutationFn: authApi.alterarSenha,
    onSuccess: ({ token }) => sessao.definirToken(token),
  });
}

export function useExcluirConta() {
  return useMutation({
    mutationFn: authApi.excluirConta,
    onSuccess: () =>
      sessao.encerrar({
        destino: '/',
        aviso: 'Pedido de exclusão registrado. Seus dados pessoais serão apagados em até 24 h.',
      }),
  });
}
