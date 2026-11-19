import {
  DEFAULT_TRACK_SPEC,
  ROLLING_STOCK,
  RollingStockSchema,
  rollingStockById,
  type RollingStock,
} from '@trains/shared';
import { describe, expect, it } from 'vitest';
import { compatibility, routeCompatibility } from './compatibility.ts';

function stock(id: string): RollingStock {
  const found = rollingStockById(id);
  if (!found) throw new Error(`matériel ${id} absent`);
  return found;
}

const LGV = { ...DEFAULT_TRACK_SPEC, designSpeedKmh: 320, signalling: 'ertms2' as const };

describe('catalogue', () => {
  it('a des identifiants uniques et des fiches valides', () => {
    const ids = ROLLING_STOCK.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ROLLING_STOCK) {
      expect(RollingStockSchema.parse(s)).toEqual(s);
      expect(s.capacity).toBeGreaterThanOrEqual(s.seats);
      expect(s.traction === 'diesel' ? s.voltages.length === 0 : s.voltages.length > 0).toBe(true);
      expect(s.category === 'fret' ? s.payloadT > 0 : s.seats > 0).toBe(true);
    }
    expect(rollingStockById('inconnu')).toBeUndefined();
  });
});

describe('compatibilité', () => {
  it('fixe la vitesse au plus faible du train, de la voie et de la signalisation', () => {
    expect(compatibility(stock('gv-duplex'), LGV)).toEqual({
      ok: true,
      issues: [],
      speedKmh: 320,
      limitedBySignalling: false,
    });
    const bal = compatibility(stock('gv-duplex'), { ...LGV, signalling: 'bal' });
    expect(bal.speedKmh).toBe(220);
    expect(bal.limitedBySignalling).toBe(true);
    expect(compatibility(stock('regional-electrique'), LGV).speedKmh).toBe(160);
    expect(compatibility(stock('gv-simple'), DEFAULT_TRACK_SPEC).speedKmh).toBe(160);
  });

  it('refuse un électrique sans caténaire et un écartement différent', () => {
    const diesel = { ...DEFAULT_TRACK_SPEC, electrification: 'none' as const };
    expect(compatibility(stock('regional-electrique'), diesel)).toMatchObject({
      ok: false,
      issues: ['power'],
      speedKmh: 0,
    });
    expect(compatibility(stock('regional-bimode'), diesel).ok).toBe(true);
    expect(compatibility(stock('autorail'), diesel).ok).toBe(true);
    expect(compatibility(stock('metrique-regional'), DEFAULT_TRACK_SPEC).issues).toEqual(['gauge']);
  });

  it('vérifie un itinéraire tronçon par tronçon', () => {
    const route = [LGV, { ...DEFAULT_TRACK_SPEC, electrification: 'none' as const }, LGV];
    expect(routeCompatibility(stock('gv-duplex'), route)).toEqual({
      ok: false,
      issues: ['power'],
      blocking: [1],
    });
    expect(routeCompatibility(stock('regional-bimode'), route).ok).toBe(true);
  });
});
