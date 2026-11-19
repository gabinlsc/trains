import { describe, expect, it } from 'vitest';
import { formatMoney } from './money.ts';

describe('montants', () => {
  it('affiche les millions puis les milliards d’euros', () => {
    expect(formatMoney(12.34)).toBe('12,3 M€');
    expect(formatMoney(999)).toBe('999 M€');
    expect(formatMoney(2345)).toMatch(/^2,35\s?Md€$/);
  });
});
