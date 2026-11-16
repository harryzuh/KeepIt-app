import { formatDataCompra, hojeIso, precoParaApi, precoParaCampo } from './util';

describe('precoParaApi', () => {
  it.each([
    ['1.234,50', '1234.50'],
    ['249,9', '249.90'],
    ['10', '10.00'],
    ['R$ 5,00', '5.00'],
    ['1234.50', '1234.50'],
    ['1.234.567,89', '1234567.89'],
  ])('converte %s para %s', (entrada, saida) => expect(precoParaApi(entrada)).toBe(saida));

  it.each(['', 'abc', '1,234,5', '12,345', '1.23.4', '-3'])('recusa %s', (entrada) => expect(precoParaApi(entrada)).toBeNull());
});

it('formata preço para o campo e data de compra sem mudar o dia', () => {
  expect(precoParaCampo('249.90')).toBe('249,90');
  expect(formatDataCompra('2026-03-15')).toBe('15/03/2026');
});

it('hojeIso usa o fuso de São Paulo', () => {
  expect(hojeIso(new Date('2026-11-16T01:00:00Z'))).toBe('2026-11-15');
});
