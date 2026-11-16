import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockarFetch, renderizarRotas } from '@/test/utils';
import RecuperarSenha from './RecuperarSenha';

const rotas = [
  { path: '/recuperar-senha', element: <RecuperarSenha /> },
  { path: '/entrar', element: <p>tela entrar</p> },
];

describe('Recuperar senha (telas 04 e 18)', () => {
  it('percorre e-mail, código e nova senha e vai ao login sem login automático', async () => {
    const f = mockarFetch({ corpo: { expiraEm: 'x' } }, { status: 204 });
    renderizarRotas(rotas, '/recuperar-senha');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@email.com');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar código' }));

    await screen.findByRole('heading', { name: 'Digite o código' });
    expect(screen.getByRole('button', { name: 'Confirmar código' })).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Dígito 1'));
    await userEvent.paste('482715');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar código' }));

    await userEvent.type(await screen.findByLabelText('Nova senha'), 'novasenha1');
    await userEvent.type(screen.getByLabelText('Confirmar nova senha'), 'novasenha1');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));

    await screen.findByText('tela entrar');
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({
      email: 'ana@email.com',
      codigo: '482715',
      novaSenha: 'novasenha1',
      confirmarSenha: 'novasenha1',
    });
    expect(localStorage.getItem('keepit.token')).toBeNull();
  });

  it('volta à etapa do código quando a API responde CODIGO_INVALIDO', async () => {
    mockarFetch({ corpo: { expiraEm: 'x' } }, { status: 400, corpo: { error: 'CODIGO_INVALIDO', message: 'x' } });
    renderizarRotas(rotas, '/recuperar-senha');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@email.com');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
    await screen.findByRole('heading', { name: 'Digite o código' });
    await userEvent.click(screen.getByLabelText('Dígito 1'));
    await userEvent.paste('111111');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar código' }));
    await userEvent.type(await screen.findByLabelText('Nova senha'), 'novasenha1');
    await userEvent.type(screen.getByLabelText('Confirmar nova senha'), 'novasenha1');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    expect(await screen.findByText(/Código inválido ou expirado/)).toBeInTheDocument();
  });
});
