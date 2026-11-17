import { describe, expect, it } from 'vitest';
import { ElevationGrid } from './elevation.ts';
import { haversineDistance, type LngLat } from './geo.ts';
import {
  EARTHWORK_LIMIT_M,
  gapCost,
  gradeLine,
  proposeStructures,
  sampleProfile,
} from './profile.ts';

/** Grille 10 × 1 de 0,01° : altitude croissante d'ouest en est (100, 110, …). */
const grid = ElevationGrid.fromValues(
  { cols: 10, rows: 1, west: 2, north: 47.005, dlon: 0.01, dlat: 0.01 },
  Int16Array.from({ length: 10 }, (_, i) => 100 + i * 10),
);

const at = (values: readonly number[], i: number): number => values[i] ?? NaN;

function maxSlope(distance: number[], z: number[]): number {
  let max = 0;
  for (let i = 1; i < z.length; i++) {
    max = Math.max(
      max,
      Math.abs((at(z, i) - at(z, i - 1)) / (at(distance, i) - at(distance, i - 1))),
    );
  }
  return max;
}

describe('sampleProfile', () => {
  it('échantillonne à pas régulier, extrémités comprises', () => {
    const line: LngLat[] = [
      [2.005, 47.0],
      [2.085, 47.0],
    ];
    const samples = sampleProfile(line, grid, 1000);
    const total = haversineDistance(line[0] as LngLat, line[1] as LngLat);
    expect(samples[0]?.distance).toBe(0);
    expect(samples.at(-1)?.distance).toBeCloseTo(total, 6);
    expect(samples[1]?.distance).toBe(1000);
    expect(samples[0]?.elevation).toBeCloseTo(100, 6);
    expect(samples.at(-1)?.elevation).toBeCloseTo(180, 6);
  });

  it('suit une polyligne à plusieurs sommets et signale le hors-grille', () => {
    const samples = sampleProfile(
      [
        [2.005, 47.0],
        [2.05, 47.0],
        [2.05, 48.0],
      ],
      grid,
      500,
    );
    expect(samples.some((s) => s.elevation === null)).toBe(true);
    expect(sampleProfile([], grid)).toEqual([]);
    expect(sampleProfile([[2.005, 47.0]], grid)).toHaveLength(1);
  });
});

describe('ligne rouge et ouvrages', () => {
  // Profil de 20 km échantillonné tous les 100 m : plaine, vallée de 120 m
  // de profondeur, plaine, puis crête de 150 m.
  const distance = Array.from({ length: 201 }, (_, i) => i * 100);
  const terrain = distance.map((d) => {
    if (d > 4000 && d < 8000) return 200 - 120 * Math.sin(((d - 4000) / 4000) * Math.PI);
    if (d > 12_000 && d < 16_000) return 200 + 150 * Math.sin(((d - 12_000) / 4000) * Math.PI);
    return 200;
  });

  it('respecte la rampe maximale', () => {
    const track = gradeLine(distance, terrain, 25);
    expect(maxSlope(distance, track)).toBeLessThanOrEqual(0.025 + 1e-9);
  });

  it('se confond avec un terrain déjà conforme, à la résolution près', () => {
    const gentle = distance.map((d) => 100 + d * 0.01);
    const track = gradeLine(distance, gentle, 25);
    track.forEach((z, i) => {
      expect(Math.abs(z - at(gentle, i))).toBeLessThanOrEqual(0.5);
    });
  });

  it('suit le terrain hors des obstacles', () => {
    const track = gradeLine(distance, terrain, 25);
    // Plaine centrale entre la vallée et la crête.
    for (let d = 9500; d <= 10_500; d += 100) expect(track[d / 100]).toBeCloseTo(200, 0);
  });

  it('complète les points hors grille et accepte un profil vide', () => {
    expect(gradeLine([], [], 25)).toEqual([]);
    const withHoles = gradeLine([0, 100, 200], [null, 50, null], 25);
    expect(withHoles).toEqual([50, 50, 50]);
  });

  it('ne pénalise presque plus un écart au-delà de la limite des terrassements', () => {
    expect(gapCost(-10)).toBe(10);
    expect(gapCost(15)).toBe(15);
    expect(gapCost(115)).toBeCloseTo(20, 9);
  });

  it('propose un viaduc dans la vallée et un tunnel sous la crête', () => {
    const track = gradeLine(distance, terrain, 25);
    const structures = proposeStructures(distance, terrain, track);
    expect(structures.map((s) => s.kind)).toEqual(['viaduct', 'tunnel']);
    const [viaduct, tunnel] = structures;
    expect(viaduct?.from).toBeGreaterThan(4000);
    expect(viaduct?.to).toBeLessThan(8000);
    expect(tunnel?.from).toBeGreaterThan(12_000);
    expect(tunnel?.depth).toBeGreaterThan(EARTHWORK_LIMIT_M);
  });

  it('ne propose rien avec une rampe permissive ou des écarts trop courts', () => {
    const track = gradeLine(distance, terrain, 200);
    expect(proposeStructures(distance, terrain, track)).toEqual([]);
    const spike = [0, 0, 30, 0, 0];
    expect(proposeStructures([0, 10, 20, 30, 40], spike, [0, 0, 0, 0, 0])).toEqual([]);
  });

  it('clôt un ouvrage qui touche l’extrémité du tracé', () => {
    const d = [0, 100, 200, 300];
    const t = [0, 0, 50, 50];
    const result = proposeStructures(d, t, [0, 0, 0, 0]);
    expect(result).toEqual([{ kind: 'tunnel', from: 200, to: 300, depth: 50 }]);
  });
});
