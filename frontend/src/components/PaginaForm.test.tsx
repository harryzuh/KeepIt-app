import { screen } from '@testing-library/react';
import { renderizarRotas } from '@/test/utils';
import { PaginaForm } from './PaginaForm';

describe('PaginaForm', () => {
  it('renderiza o título como h1', () => {
    renderizarRotas([{ path: '/', element: <PaginaForm titulo="Planos">x</PaginaForm> }]);
    expect(screen.getByRole('heading', { level: 1, name: 'Planos' })).toBeInTheDocument();
  });
});
