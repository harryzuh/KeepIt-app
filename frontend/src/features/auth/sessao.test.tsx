import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AlterarSenha from '@/pages/AlterarSenha';
import Entrar from '@/pages/Entrar';
import { sessao } from '@/lib/sessao';
import { mockarFetch, perfilExemplo, renderizarRotas } from '@/test/utils';
import { RotaProtegida, RotaPublica } from './guardas';

const rotas = [
  { element: <RotaPublica />, children: [{ path: '/entrar', element: <Entrar /> }] },
  { element: <RotaProtegida />, children: [{ path: '/conta/senha', element: <AlterarSenha /> }, { path: '/inicio', element: <p>inicio</p> }] },
];

describe('guardas de rota e sessão', () => {
  it('rota protegida sem token redireciona para a tela 02', async () => {
    renderizarRotas(rotas, '/inicio');
    expect(await screen.findByRole('heading', { name: 'Bem-vindo de volta' })).toBeInTheDocument();
  });

  it('rota pública com token redireciona para a tela 05', async () => {
    sessao.definirToken('t');
    mockarFetch({ corpo: perfilExemplo });
    renderizarRotas(rotas, '/entrar');
    expect(await screen.findByText('inicio')).toBeInTheDocument();
  });

  it('401 SESSAO_EXPIRADA derruba a sessão e volta ao login com aviso', async () => {
    sessao.definirToken('velho');
    mockarFetch({ status: 401, corpo: { error: 'SESSAO_EXPIRADA', message: 'x' } });
    renderizarRotas(rotas, '/inicio');
    expect(await screen.findByText('Sua sessão expirou. Entre novamente.')).toBeInTheDocument();
    expect(localStorage.getItem('keepit.token')).toBeNull();
  });

  it('SENHA_INCORRETA não encerra a sessão e aparece no campo', async () => {
    sessao.definirToken('t');
    mockarFetch({ corpo: perfilExemplo }, { status: 401, corpo: { error: 'SENHA_INCORRETA', message: 'x' } });
    renderizarRotas(rotas, '/conta/senha');
    await userEvent.type(await screen.findByLabelText('Senha atual'), 'atual123');
    await userEvent.type(screen.getByLabelText('Nova senha'), 'nova12345');
    await userEvent.type(screen.getByLabelText('Confirmar nova senha'), 'nova12345');
    await userEvent.click(screen.getByRole('button', { name: 'Alterar senha' }));
    expect(await screen.findByText('Senha atual incorreta')).toBeInTheDocument();
    expect(localStorage.getItem('keepit.token')).toBe('t');
  });
});
