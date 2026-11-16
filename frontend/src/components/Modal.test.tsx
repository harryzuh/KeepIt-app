import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from './Input';
import { Modal } from './Modal';

describe('Modal', () => {
  it('retém o foco dentro do diálogo ao navegar com Tab e Shift+Tab', async () => {
    render(
      <>
        <button>fora</button>
        <Modal aberto titulo="Teste" aoFechar={() => {}}>
          <Input label="Digite sua senha para confirmar" type="password" />
          <button>Confirmar</button>
        </Modal>
      </>,
    );
    const dialogo = screen.getByRole('dialog');
    for (let i = 0; i < 8; i++) {
      await userEvent.tab();
      expect(dialogo.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await userEvent.tab({ shift: true });
      expect(dialogo.contains(document.activeElement)).toBe(true);
    }
  });
});

describe('Input de senha', () => {
  it('botão de mostrar senha tem rótulo próprio, sem repetir o texto do campo', async () => {
    render(<Input label="Digite sua senha para confirmar" type="password" />);
    const botao = screen.getByRole('button', { name: 'Mostrar senha' });
    await userEvent.click(botao);
    expect(screen.getByRole('button', { name: 'Ocultar senha' })).toBeInTheDocument();
  });
});
