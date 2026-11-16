import { centavos, formatDinheiro, percentualDe } from './format';

const nbsp = ' ';

describe('formatDinheiro (string decimal da API, sem Number)', () => {
  it('formata em BRL', () => {
    expect(formatDinheiro('12345.67')).toBe(`R$${nbsp}12.345,67`);
    expect(formatDinheiro('0.00')).toBe(`R$${nbsp}0,00`);
  });

  it('mantém a precisão em valores acima de 2^53 centavos, sem notação científica', () => {
    // 9.999.999.999,99 × 1.000.000 = 9.999.999.999.990.000,00
    expect(formatDinheiro('9999999999990000.00')).toBe(`R$${nbsp}9.999.999.999.990.000,00`);
    expect(formatDinheiro('99999999999999999999.99')).toBe(`R$${nbsp}99.999.999.999.999.999.999,99`);
  });

  it('valor fora do formato vira traço', () => {
    expect(formatDinheiro('abc')).toBe('—');
    expect(formatDinheiro('1e21')).toBe('—');
  });
});

describe('percentualDe', () => {
  it('calcula com 1 casa em inteiros', () => {
    expect(percentualDe('996.00', '5754.60')?.texto).toBe('17,3%');
    expect(percentualDe('50.00', '100.00')).toEqual({ texto: '50,0%', largura: 50 });
  });

  it('total zero devolve null (sem divisão por zero)', () => {
    expect(percentualDe('0.00', '0.00')).toBeNull();
  });

  it('participação acima de 100% (produto em várias tags) limita só a barra', () => {
    const p = percentualDe('200.00', '100.00');
    expect(p?.texto).toBe('200,0%');
    expect(p?.largura).toBe(100);
  });

  it('não perde precisão em valores enormes', () => {
    expect(percentualDe('4999999999995000.00', '9999999999990000.00')?.texto).toBe('50,0%');
  });
});

describe('centavos', () => {
  it('converte exato', () => {
    expect(centavos('1.05')).toBe(105n);
    expect(centavos('x')).toBeNull();
  });
});
