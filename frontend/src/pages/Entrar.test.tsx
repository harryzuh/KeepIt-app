import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RotaPublica } from '@/features/auth/guardas';
import { mockarFetch, perfilExemplo, renderizarRotas } from '@/test/utils';
import Entrar from './Entrar';

const rotas = [
  { element: <RotaPublica />, children: [{ path: '/entrar', element: <Entrar /> }] },
  { path: '/inicio', element: <p>tela inicio</p> },
];

describe('Entrar (tela 02)', () => {
  it('valida e-mail e mantém o botão desabilitado enquanto inválido', async () => {
    renderizarRotas(rotas, '/entrar');
    const botao = screen.getByRole('button', { name: 'Entrar' });
    expect(botao).toBeDisabled();
    await userEvent.type(screen.getByLabelText('E-mail'), 'invalido');
    expect(await screen.findByText('E-mail inválido')).toBeInTheDocument();
    expect(botao).toBeDisabled();
  });

  it('chama POST /auth/login, guarda o token e vai para a tela 05', async () => {
    const fetchFalso = mockarFetch({ corpo: { token: 'abc', usuario: perfilExemplo } });
    renderizarRotas(rotas, '/entrar');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana.silva@email.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'segredo123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await screen.findByText('tela inicio');
    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toMatch(/\/auth\/login$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ email: 'ana.silva@email.com', senha: 'segredo123' });
    expect(localStorage.getItem('keepit.token')).toBe('abc');
  });

  it('mostra mensagem genérica em CREDENCIAIS_INVALIDAS sem encerrar sessão', async () => {
    mockarFetch({ status: 401, corpo: { error: 'CREDENCIAIS_INVALIDAS', message: 'x' } });
    renderizarRotas(rotas, '/entrar');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@email.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('E-mail ou senha inválidos')).toBeInTheDocument();
    expect(localStorage.getItem('keepit.token')).toBeNull();
  });

  it('avisa quando não há conexão', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('falha'));
    vi.stubGlobal('fetch', f);
    renderizarRotas(rotas, '/entrar');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@email.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'qualquer1');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(screen.getByText(/Sem conexão com a internet/)).toBeInTheDocument());
  });
});
