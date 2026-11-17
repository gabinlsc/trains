import { describe, expect, it } from 'vitest';
import {
  checkCurvature,
  classifyGrade,
  gradeLimits,
  maxGrade,
  maxSpeedForRadius,
  minRadiusForSpeed,
  smoothAlignment,
} from './alignment.ts';
import { circumradius, haversineDistance, polylineLength, type LngLat } from './geo.ts';

describe('rayons et vitesses', () => {
  it('retrouve les valeurs de référence', () => {
    expect(minRadiusForSpeed(100)).toBe(400);
    expect(minRadiusForSpeed(160)).toBe(1000);
    expect(minRadiusForSpeed(220)).toBe(2500);
    expect(minRadiusForSpeed(320)).toBe(7000);
  });

  it('interpole entre les valeurs et prolonge en V² au-delà', () => {
    expect(minRadiusForSpeed(130)).toBe(700);
    expect(minRadiusForSpeed(50)).toBe(100);
    expect(minRadiusForSpeed(350)).toBeCloseTo(7000 * (350 / 320) ** 2, 6);
  });

  it('est croissant et inversé par maxSpeedForRadius', () => {
    let previous = 0;
    for (let v = 40; v <= 360; v += 10) {
      const r = minRadiusForSpeed(v);
      expect(r).toBeGreaterThan(previous);
      previous = r;
      expect(maxSpeedForRadius(r)).toBeCloseTo(v, 6);
    }
    expect(maxSpeedForRadius(Infinity)).toBe(Infinity);
  });
});

// Ligne brisée à angle droit, environ 10 km par alignement, autour de Bourges.
const CORNER: LngLat[] = [
  [2.2, 47.0],
  [2.4, 47.0],
  [2.4, 47.09],
];

describe('raccordement par arcs', () => {
  it('produit un tracé qui respecte le rayon demandé', () => {
    const smooth = smoothAlignment(CORNER, { radius: 2500 });
    expect(smooth.length).toBeGreaterThan(10);
    expect(checkCurvature(smooth, 2500)).toEqual([]);
    // L'arc coupe l'angle : le tracé est plus court que la ligne brisée.
    expect(polylineLength(smooth)).toBeLessThan(polylineLength(CORNER));
    expect(smooth[0]).toEqual(CORNER[0]);
    expect(smooth.at(-1)).toEqual(CORNER[2]);
  });

  it('dessine un arc du rayon demandé', () => {
    const smooth = smoothAlignment(CORNER, { radius: 3000, maxStepRad: 0.01 });
    const mid = Math.floor(smooth.length / 2);
    const r = circumradius(
      smooth[mid - 1] as LngLat,
      smooth[mid] as LngLat,
      smooth[mid + 1] as LngLat,
    );
    expect(r).toBeGreaterThan(2950);
    expect(r).toBeLessThan(3050);
  });

  it('réduit le rayon quand les alignements sont trop courts', () => {
    const tight: LngLat[] = [
      [2.0, 47.0],
      [2.01, 47.0],
      [2.01, 47.01],
    ];
    const smooth = smoothAlignment(tight, { radius: 7000 });
    expect(checkCurvature(smooth, 7000).length).toBeGreaterThan(0);
    expect(haversineDistance(smooth[1] as LngLat, tight[0] as LngLat)).toBeGreaterThan(0);
  });

  it('laisse intacts les alignements droits et les tracés trop courts', () => {
    const straight: LngLat[] = [
      [2, 47],
      [2.1, 47],
      [2.2, 47],
    ];
    expect(smoothAlignment(straight, { radius: 1000 })).toEqual(straight);
    expect(smoothAlignment(straight.slice(0, 2), { radius: 1000 })).toEqual(straight.slice(0, 2));
    const duplicate: LngLat[] = [
      [2, 47],
      [2, 47],
      [2.1, 47],
    ];
    expect(smoothAlignment(duplicate, { radius: 1000 })).toHaveLength(2);
  });
});

describe('contrôle de courbure', () => {
  it('signale un angle vif, même entre de longs alignements', () => {
    expect(checkCurvature(CORNER, 1000)).toEqual([{ index: 1, radius: 0, required: 1000 }]);
  });

  it('estime le rayon d’une courbe finement discrétisée', () => {
    const arc = smoothAlignment(CORNER, { radius: 800 });
    const issues = checkCurvature(arc, 1000);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.radius).toBeGreaterThan(780);
      expect(issue.radius).toBeLessThan(820);
    }
  });

  it('ignore les points confondus', () => {
    expect(
      checkCurvature(
        [
          [2, 47],
          [2, 47],
          [2.1, 47.1],
        ],
        1000,
      ),
    ).toEqual([]);
  });
});

describe('déclivités', () => {
  it('fixe les limites selon la vitesse', () => {
    expect(gradeLimits(320)).toEqual({ normal: 35, mountain: 70 });
    expect(gradeLimits(160)).toEqual({ normal: 25, mountain: 70 });
  });

  it('classe les rampes', () => {
    expect(classifyGrade(30, 320)).toBe('ok');
    expect(classifyGrade(30, 160)).toBe('steep');
    expect(classifyGrade(-55, 100)).toBe('mountain');
    expect(classifyGrade(90, 100)).toBe('rack');
  });

  it('mesure la rampe maximale sur une base glissante', () => {
    // 2 km à plat puis 1 km à 30 ‰, échantillonné tous les 250 m.
    const profile = Array.from({ length: 13 }, (_, i) => {
      const distance = i * 250;
      return { distance, elevation: distance <= 2000 ? 100 : 100 + (distance - 2000) * 0.03 };
    });
    expect(maxGrade(profile)).toBeCloseTo(30, 6);
    // Une seule marche brutale de 10 m est diluée sur la base de 1 km.
    const step = [
      { distance: 0, elevation: 0 },
      { distance: 250, elevation: 10 },
      { distance: 1250, elevation: 10 },
    ];
    expect(maxGrade(step)).toBeLessThan(11);
    expect(maxGrade([])).toBe(0);
  });
});
