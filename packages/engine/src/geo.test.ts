import { describe, expect, it } from 'vitest';
import {
  circumradius,
  EARTH_RADIUS_M,
  haversineDistance,
  initialBearing,
  polylineLength,
  toRadians,
  type LngLat,
} from './geo.ts';

const PARIS: LngLat = [2.3522, 48.8566];
const LYON: LngLat = [4.8357, 45.764];
const MARSEILLE: LngLat = [5.3698, 43.2965];

describe('haversineDistance', () => {
  it('vaut zéro pour un même point', () => {
    expect(haversineDistance(PARIS, PARIS)).toBe(0);
  });

  it('donne Paris–Lyon à vol d’oiseau (~391,5 km)', () => {
    expect(haversineDistance(PARIS, LYON) / 1000).toBeCloseTo(391.5, 1);
  });

  it('est symétrique', () => {
    expect(haversineDistance(PARIS, MARSEILLE)).toBeCloseTo(haversineDistance(MARSEILLE, PARIS), 6);
  });

  it('reste borné aux antipodes', () => {
    expect(haversineDistance([0, 0], [180, 0])).toBeCloseTo(Math.PI * EARTH_RADIUS_M, 0);
  });
});

describe('polylineLength', () => {
  it('vaut zéro pour moins de deux points', () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([PARIS])).toBe(0);
  });

  it('additionne les segments', () => {
    const expected = haversineDistance(PARIS, LYON) + haversineDistance(LYON, MARSEILLE);
    expect(polylineLength([PARIS, LYON, MARSEILLE])).toBeCloseTo(expected, 6);
  });
});

describe('initialBearing', () => {
  it('donne les quatre points cardinaux', () => {
    expect(initialBearing([0, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(initialBearing([0, 0], [1, 0])).toBeCloseTo(90, 6);
    expect(initialBearing([0, 1], [0, 0])).toBeCloseTo(180, 6);
    expect(initialBearing([1, 0], [0, 0])).toBeCloseTo(270, 6);
  });

  it('oriente Paris → Marseille vers le sud-sud-est', () => {
    const bearing = initialBearing(PARIS, MARSEILLE);
    expect(bearing).toBeGreaterThan(140);
    expect(bearing).toBeLessThan(170);
  });
});

describe('circumradius', () => {
  it('est infini pour trois points alignés', () => {
    expect(circumradius([2, 46], [2, 46.01], [2, 46.02])).toBe(Number.POSITIVE_INFINITY);
  });

  it('retrouve le rayon d’un arc de cercle connu', () => {
    // Trois points sur un cercle de 1 000 m centré à l’origine (projection
    // locale équirectangulaire, suffisante à cette échelle).
    const lat0 = 46;
    const r = 1000;
    const mPerDegLat = toRadians(1) * EARTH_RADIUS_M;
    const mPerDegLng = mPerDegLat * Math.cos(toRadians(lat0));
    const onCircle = (angleDeg: number): LngLat => [
      (r * Math.cos(toRadians(angleDeg))) / mPerDegLng,
      lat0 + (r * Math.sin(toRadians(angleDeg))) / mPerDegLat,
    ];
    expect(circumradius(onCircle(60), onCircle(90), onCircle(120))).toBeCloseTo(r, -1);
  });

  it('est infini si deux points sont confondus', () => {
    expect(circumradius(PARIS, PARIS, LYON)).toBe(Number.POSITIVE_INFINITY);
  });
});
