import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CHAVE_PERFIL } from '@/features/auth/hooks';
import { queryClient } from '@/lib/queryClient';
import { mockarFetch, perfilExemplo, renderizarRotas } from '@/test/utils';
import DadosCadastrais from './DadosCadastrais';

const rotas = [{ path: '/conta/dados', element: <DadosCadastrais /> }];

function abrirTela() {
  localStorage.setItem('keepit.token', 'token-antigo');
  queryClient.setQueryData(CHAVE_PERFIL, perfilExemplo);
  renderizarRotas(rotas, '/conta/dados');
}

async function trocarEmail(novo: string) {
  const campo = screen.getByLabelText('E-mail');
  await userEvent.clear(campo);
  await userEvent.type(campo, novo);
}

describe('DadosCadastrais (tela 20) — troca de e-mail', () => {
  it('só pede a senha atual quando o e-mail muda', async () => {
    abrirTela();
    expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument();
    await trocarEmail('ana.nova@email.com');
    expect(screen.getByLabelText('Senha atual')).toBeInTheDocument();
  });

  it('não chama a API sem a senha atual', async () => {
    const fetchFalso = mockarFetch();
    abrirTela();
    await trocarEmail('ana.nova@email.com');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('Informe sua senha atual para trocar o e-mail')).toBeInTheDocument();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('mostra SENHA_INCORRETA no campo sem encerrar a sessão', async () => {
    mockarFetch({ status: 401, corpo: { error: 'SENHA_INCORRETA', message: 'x' } });
    abrirTela();
    await trocarEmail('ana.nova@email.com');
    await userEvent.type(screen.getByLabelText('Senha atual'), 'errada123');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('Senha atual incorreta')).toBeInTheDocument();
    expect(localStorage.getItem('keepit.token')).toBe('token-antigo');
  });

  it('envia senhaAtual, confirma o código e guarda o token novo', async () => {
    const fetchFalso = mockarFetch(
      { status: 202, corpo: { expiraEm: '2026-11-15T18:00:00.000Z' } },
      { corpo: { ...perfilExemplo, email: 'ana.nova@email.com', token: 'token-novo' } },
    );
    abrirTela();
    await trocarEmail('ana.nova@email.com');
    await userEvent.type(screen.getByLabelText('Senha atual'), 'segredo123');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByRole('heading', { name: 'Confirme o novo e-mail' })).toBeInTheDocument();
    const [url1, init1] = fetchFalso.mock.calls[0];
    expect(url1).toMatch(/\/me\/email$/);
    expect(JSON.parse(init1.body)).toEqual({ email: 'ana.nova@email.com', senhaAtual: 'segredo123' });

    for (let i = 1; i <= 6; i++) await userEvent.type(screen.getByLabelText(`Dígito ${i}`), String(i));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e-mail' }));

    expect(await screen.findByText(/E-mail alterado/)).toBeInTheDocument();
    expect(fetchFalso.mock.calls[1][0]).toMatch(/\/me\/email\/confirmar$/);
    expect(localStorage.getItem('keepit.token')).toBe('token-novo');
    expect(queryClient.getQueryData(CHAVE_PERFIL)).not.toHaveProperty('token');
  });
});
