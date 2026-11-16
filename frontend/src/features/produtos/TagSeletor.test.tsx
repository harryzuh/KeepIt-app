import { screen } from '@testing-library/react';
import { entrarComo, mockarApi, tagsExemplo } from '@/test/produtos';
import { renderizarRotas } from '@/test/utils';
import { TagSeletor } from './TagSeletor';

describe('TagSeletor — layout do campo Nova tag', () => {
  it('o campo ocupa a largura útil (flex-1/min-w-0) e o botão Criar tag não estica (w-auto!/shrink-0)', async () => {
    entrarComo('EDITOR');
    mockarApi({ 'GET /tags': { corpo: tagsExemplo } });
    renderizarRotas([{ path: '/', element: <TagSeletor valor={[]} aoMudar={() => {}} /> }], '/');
    const campo = await screen.findByLabelText('Nova tag');
    expect(campo.closest('div.flex-1')).toHaveClass('min-w-0');
    const botao = screen.getByRole('button', { name: 'Criar tag' });
    expect(botao).toHaveClass('w-auto!', 'shrink-0');
  });

  it('chips de tag têm alvo de toque de 44px (min-h-11)', async () => {
    entrarComo('EDITOR');
    mockarApi({ 'GET /tags': { corpo: tagsExemplo } });
    renderizarRotas([{ path: '/', element: <TagSeletor valor={[]} aoMudar={() => {}} /> }], '/');
    const chips = (await screen.findAllByRole('button', { pressed: false }));
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach((c) => expect(c).toHaveClass('min-h-11'));
  });
});
