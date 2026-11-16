import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { CodigoInput } from './CodigoInput';

function Teste() {
  const [v, setV] = useState('');
  return (
    <>
      <CodigoInput valor={v} aoMudar={setV} />
      <output>{v}</output>
    </>
  );
}

describe('CodigoInput', () => {
  it('aceita só dígitos e avança entre as caixas', async () => {
    render(<Teste />);
    await userEvent.click(screen.getByLabelText('Dígito 1'));
    await userEvent.keyboard('4a82');
    expect(screen.getByRole('status')).toHaveTextContent('482');
  });

  it('aceita colar o código inteiro', async () => {
    render(<Teste />);
    await userEvent.click(screen.getByLabelText('Dígito 1'));
    await userEvent.paste('123456');
    expect(screen.getByRole('status')).toHaveTextContent('123456');
  });
});
