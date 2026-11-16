import { api } from '@/lib/api';
import type { Perfil, RespostaSessao } from './tipos';

// Uma função por rota de docs/api/m1-auth.md
export const authApi = {
  cadastro: (d: { nome: string; email: string; senha: string; confirmarSenha: string }) =>
    api<RespostaSessao>('/auth/cadastro', { method: 'POST', body: d }),
  login: (d: { email: string; senha: string }) => api<RespostaSessao>('/auth/login', { method: 'POST', body: d }),
  recuperarSenha: (email: string) => api<{ expiraEm: string }>('/auth/recuperar-senha', { method: 'POST', body: { email } }),
  redefinirSenha: (d: { email: string; codigo: string; novaSenha: string; confirmarSenha: string }) =>
    api<void>('/auth/redefinir-senha', { method: 'POST', body: d }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  perfil: () => api<Perfil>('/me'),
  atualizarNome: (nome: string) => api<Perfil>('/me', { method: 'PATCH', body: { nome } }),
  // Reautenticação obrigatória (AppSec ACH-01): a troca de e-mail exige a senha atual.
  solicitarEmail: (d: { email: string; senhaAtual: string }) =>
    api<{ expiraEm: string }>('/me/email', { method: 'POST', body: d }),
  // A confirmação encerra as outras sessões e devolve um token novo junto com o perfil.
  confirmarEmail: (codigo: string) =>
    api<Perfil & { token: string }>('/me/email/confirmar', { method: 'POST', body: { codigo } }),
  alterarSenha: (d: { senhaAtual: string; novaSenha: string; confirmarSenha: string }) =>
    api<{ token: string }>('/me/senha', { method: 'PATCH', body: d }),
  excluirConta: (senha: string) => api<void>('/me', { method: 'DELETE', body: { senha } }),
};
