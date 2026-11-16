import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockarFetch, perfilExemplo, renderizarRotas } from '@/test/utils';
import CriarConta from './CriarConta';

const rotas = [{ path: '/criar-conta', element: <CriarConta /> }];

async function preencher(senha: string, confirmar: string, email = 'ana@email.com') {
  await userEvent.type(screen.getByLabelText('Nome'), 'Ana Silva');
  await userEvent.type(screen.getByLabelText('E-mail'), email);
  await userEvent.type(screen.getByLabelText('Senha'), senha);
  await userEvent.type(screen.getByLabelText('Confirmar senha'), confirmar);
}

describe('Criar conta (tela 03)', () => {
  it('valida a senha em tempo real e bloqueia o envio quando não conferem', async () => {
    renderizarRotas(rotas, '/criar-conta');
    await preencher('12345678', '1234567');
    expect(await screen.findByText('As senhas não conferem')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeDisabled();
  });

  it('exige mínimo de 8 caracteres', async () => {
    renderizarRotas(rotas, '/criar-conta');
    await userEvent.type(screen.getByLabelText('Senha'), '1234');
    expect(await screen.findByText('Mínimo de 8 caracteres')).toBeInTheDocument();
  });

  it('envia os dados e guarda o token no cadastro', async () => {
    const fetchFalso = mockarFetch({ status: 201, corpo: { token: 't1', usuario: perfilExemplo } });
    renderizarRotas(rotas, '/criar-conta');
    await preencher('12345678', '12345678');
    await userEvent.click(await screen.findByRole('button', { name: 'Cadastrar' }));
    await vi.waitFor(() => expect(localStorage.getItem('keepit.token')).toBe('t1'));
    expect(JSON.parse(fetchFalso.mock.calls[0][1].body)).toEqual({
      nome: 'Ana Silva',
      email: 'ana@email.com',
      senha: '12345678',
      confirmarSenha: '12345678',
    });
  });

  it('mostra EMAIL_EM_USO junto ao campo de e-mail', async () => {
    mockarFetch({ status: 409, corpo: { error: 'EMAIL_EM_USO', message: 'x' } });
    renderizarRotas(rotas, '/criar-conta');
    await preencher('12345678', '12345678');
    await userEvent.click(await screen.findByRole('button', { name: 'Cadastrar' }));
    expect(await screen.findByText('Este e-mail já está cadastrado')).toBeInTheDocument();
  });
});
