import { rollingStockById, type RollingStock } from '@trains/shared';
import { describe, expect, it } from 'vitest';
import { smoothAlignment, type LngLat } from './index.ts';
import { availableAcceleration, fleetSize, runLeg, speedLimits, timetable } from './travel.ts';

function stock(id: string): RollingStock {
  const found = rollingStockById(id);
  if (!found) throw new Error(id);
  return found;
}

/** Ligne droite vers l'est, longueur approximative en km. */
function straight(km: number): LngLat[] {
  const dLng = km / (111.32 * Math.cos((47 * Math.PI) / 180));
  return [
    [2, 47],
    [2 + dLng / 2, 47],
    [2 + dLng, 47],
  ];
}

describe('performances', () => {
  it('borne l’accélération par l’adhérence puis par la puissance', () => {
    const tgv = stock('gv-duplex');
    expect(availableAcceleration(tgv, 1)).toBe(tgv.accelerationMs2);
    expect(availableAcceleration(tgv, 80)).toBeCloseTo((9300 * 1000) / (390 * 1000 * 80));
  });
});

describe('marches types', () => {
  it('parcourt 100 km de LGV en un peu moins de vingt-deux minutes', () => {
    const run = runLeg([{ path: straight(100), speedKmh: 320 }], stock('gv-duplex'));
    expect(run.lengthM).toBeCloseTo(100_000, -3);
    // 100 km à 320 km/h : 18 min 45 s, plus accélération et freinage.
    expect(run.runningS).toBeGreaterThan(1125);
    expect(run.runningS).toBeLessThan(1350);
    expect(Math.max(...run.profile.map((p) => p.speedKmh))).toBeCloseTo(320, 0);
    expect(run.profile[0]?.speedKmh).toBe(0);
    expect(run.profile.at(-1)?.speedKmh).toBe(0);
  });

  it('n’atteint pas sa vitesse maximale entre deux arrêts rapprochés', () => {
    const run = runLeg([{ path: straight(2), speedKmh: 160 }], stock('regional-electrique'));
    expect(Math.max(...run.profile.map((p) => p.speedKmh))).toBeLessThan(140);
    expect(run.runningS).toBeGreaterThan(2000 / (160 / 3.6));
  });

  it('ralentit dans une courbe serrée sur toute la longueur du train', () => {
    const corner: LngLat[] = [
      [2, 47],
      [2.05, 47],
      [2.05, 47.05],
    ];
    const path = smoothAlignment(corner, { radius: 400 });
    const limits = speedLimits([{ path, speedKmh: 160 }], 72);
    expect(Math.min(...limits.limit)).toBeLessThan(110);
    expect(Math.max(...limits.limit)).toBe(160);
    const fast = runLeg([{ path: straight(8), speedKmh: 160 }], stock('regional-electrique'));
    const slow = runLeg([{ path, speedKmh: 160 }], stock('regional-electrique'));
    expect(slow.runningS).toBeGreaterThan(fast.runningS * 0.85);
  });

  it('respecte la vitesse du morceau le plus lent', () => {
    const run = runLeg(
      [
        { path: straight(10), speedKmh: 160 },
        { path: straight(10).map(([x, y]) => [x + 0.131, y] as LngLat), speedKmh: 80 },
      ],
      stock('intercites-electrique'),
    );
    const tail = run.profile.filter((p) => p.distance > 12_000 && p.distance < 18_000);
    expect(Math.max(...tail.map((p) => p.speedKmh))).toBeLessThanOrEqual(80.001);
  });
});

describe('horaires et parc', () => {
  it('ajoute la marge et les arrêts intermédiaires', () => {
    const result = timetable([{ runningS: 600 }, { runningS: 1200 }], [0, 90, 0], 0.05);
    const flat = result.stops.flatMap((s) => [s.arrivalS, s.departureS]);
    [0, 0, 630, 720, 1980, 1980].forEach((value, i) => {
      expect(flat[i]).toBeCloseTo(value);
    });
    expect(result.totalS).toBeCloseTo(1980);
  });

  it('dimensionne le parc pour tenir la cadence', () => {
    // Aller de 50 min, battements de 10 min : cycle de 2 h.
    expect(fleetSize(50 * 60, 60)).toBe(2);
    expect(fleetSize(50 * 60, 30)).toBe(4);
    expect(fleetSize(5 * 60, 240)).toBe(1);
  });
});
