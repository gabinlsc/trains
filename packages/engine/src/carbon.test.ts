import { describe, expect, it } from 'vitest';
import { avoidedEmissionsT, EMISSIONS_KG_PER_PKM } from './carbon.ts';

describe('bilan carbone', () => {
  it('compte le report de la voiture vers le train', () => {
    expect(avoidedEmissionsT(1_000_000, 'electric')).toBeCloseTo(125);
    expect(avoidedEmissionsT(1_000_000, 'diesel')).toBeCloseTo(50);
    expect(avoidedEmissionsT(0, 'bimode')).toBe(0);
    expect(EMISSIONS_KG_PER_PKM.electric).toBeLessThan(EMISSIONS_KG_PER_PKM.bimode);
  });
});
