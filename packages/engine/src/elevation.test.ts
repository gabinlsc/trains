import { describe, expect, it } from 'vitest';
import {
  ELEVATION_HEADER_BYTES,
  ELEVATION_NODATA,
  ElevationFormatError,
  ElevationGrid,
  encodeElevationGrid,
  type ElevationGridSpec,
} from './elevation.ts';

// Grille 3 × 2 de 0,1° : centres aux longitudes 2,05 / 2,15 / 2,25 et
// latitudes 46,95 (ligne nord) / 46,85 (ligne sud).
const SPEC: ElevationGridSpec = { cols: 3, rows: 2, west: 2, north: 47, dlon: 0.1, dlat: 0.1 };
const VALUES = Int16Array.from([100, 200, 300, 400, 500, 600]);

describe('format binaire', () => {
  it('encode puis décode à l’identique', () => {
    const bytes = encodeElevationGrid(SPEC, VALUES);
    expect(bytes.byteLength).toBe(ELEVATION_HEADER_BYTES + 12);
    const grid = ElevationGrid.decode(bytes);
    expect(grid.spec).toEqual(SPEC);
    expect(grid.sample([2.05, 46.95])).toBe(100);
  });

  it('lit une grille placée à un décalage quelconque d’un tampon', () => {
    const bytes = encodeElevationGrid(SPEC, VALUES);
    const padded = new Uint8Array(bytes.byteLength + 3);
    padded.set(bytes, 3);
    expect(ElevationGrid.decode(padded.subarray(3)).sample([2.25, 46.85])).toBeCloseTo(600, 9);
  });

  it('refuse un nombre de valeurs incohérent à l’encodage', () => {
    expect(() => encodeElevationGrid(SPEC, new Int16Array(5))).toThrow(ElevationFormatError);
  });

  it('refuse un fichier tronqué, de mauvaise signature ou de dimensions nulles', () => {
    const bytes = encodeElevationGrid(SPEC, VALUES);
    expect(() => ElevationGrid.decode(bytes.subarray(0, 10))).toThrow(/en-tête tronqué/);
    expect(() => ElevationGrid.decode(bytes.subarray(0, bytes.byteLength - 2))).toThrow(/octets/);
    const wrong = bytes.slice();
    wrong[0] = 0x58;
    expect(() => ElevationGrid.decode(wrong)).toThrow(/signature/);
    const empty = encodeElevationGrid({ ...SPEC, cols: 0, rows: 0 }, new Int16Array(0));
    expect(() => ElevationGrid.decode(empty)).toThrow(/dimensions nulles/);
  });
});

describe('échantillonnage', () => {
  const grid = ElevationGrid.fromValues(SPEC, VALUES);

  it('interpole linéairement entre deux centres', () => {
    expect(grid.sample([2.1, 46.95])).toBeCloseTo(150, 6);
    expect(grid.sample([2.05, 46.9])).toBeCloseTo(250, 6);
  });

  it('interpole au milieu de quatre centres', () => {
    expect(grid.sample([2.1, 46.9])).toBeCloseTo(300, 6);
  });

  it('prolonge les bords d’une demi-cellule et renvoie null au-delà', () => {
    expect(grid.sample([2.0, 47.0])).toBeCloseTo(100, 9);
    expect(grid.sample([2.3, 46.8])).toBeCloseTo(600, 9);
    expect(grid.sample([1.99, 46.9])).toBeNull();
    expect(grid.sample([2.1, 47.01])).toBeNull();
  });

  it('écarte les cellules sans donnée et renormalise les poids', () => {
    const coast = ElevationGrid.fromValues(
      SPEC,
      Int16Array.from([
        10,
        ELEVATION_NODATA,
        ELEVATION_NODATA,
        30,
        ELEVATION_NODATA,
        ELEVATION_NODATA,
      ]),
    );
    expect(coast.sample([2.1, 46.9])).toBeCloseTo(20, 6);
    expect(coast.sample([2.25, 46.85])).toBeNull();
  });
});
