import { describe, expect, it } from 'vitest';
import { adicionarMeses } from './datas.js';

describe('adicionarMeses', () => {
  it('soma meses de calendário preservando o dia e a hora', () => {
    expect(adicionarMeses(new Date('2026-11-15T12:30:00Z'), 1).toISOString()).toBe('2026-12-15T12:30:00.000Z');
  });
  it('vira o ano', () => {
    expect(adicionarMeses(new Date('2026-12-20T00:00:00Z'), 1).toISOString()).toBe('2027-01-20T00:00:00.000Z');
  });
  it('usa o último dia quando o dia não existe no mês de destino', () => {
    expect(adicionarMeses(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(adicionarMeses(new Date('2028-01-31T10:00:00Z'), 1).toISOString()).toBe('2028-02-29T10:00:00.000Z');
  });
});
