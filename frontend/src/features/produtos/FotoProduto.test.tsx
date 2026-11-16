import { fireEvent, render, screen } from '@testing-library/react';
import { FotoProduto } from './FotoProduto';

const foto = { id: 1, url: 'http://s3/x.png', ordem: 0 } as never;

describe('FotoProduto', () => {
  it('chama aoFalhar quando a imagem dispara erro e mostra o quadro neutro', () => {
    const aoFalhar = vi.fn();
    render(<FotoProduto foto={foto} nome="Cafeteira" aoFalhar={aoFalhar} />);
    fireEvent.error(screen.getByRole('img'));
    expect(aoFalhar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('trata como falha a imagem que já terminou com erro antes de o handler existir', () => {
    const aoFalhar = vi.fn();
    const completa = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    render(<FotoProduto foto={foto} nome="Cafeteira" aoFalhar={aoFalhar} />);
    completa.mockRestore();
    expect(aoFalhar).toHaveBeenCalledTimes(1);
  });
});
