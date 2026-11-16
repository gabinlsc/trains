import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ELEVATION_NODATA, ElevationGrid, type ElevationGridSpec } from '@trains/engine';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildElevationGrid,
  decodeTerrarium,
  GRID_SPEC,
  lngLatToPixel,
  loadTiles,
  resample,
  TERRARIUM_ZOOM,
  tileRange,
  tileUrl,
  type TileStore,
} from '../src/steps/elevation.ts';

/** Encodage Terrarium inverse, pour fabriquer des tuiles d'essai. */
function terrariumPng(height: (px: number, py: number) => number, size = 256): Buffer {
  const png = new PNG({ width: size, height: size });
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const v = height(px, py) + 32768;
      const i = (py * size + px) * 4;
      png.data[i] = Math.floor(v / 256);
      png.data[i + 1] = Math.floor(v % 256);
      png.data[i + 2] = Math.round((v - Math.floor(v)) * 256);
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe('projection et tuiles', () => {
  it('place l’origine et le méridien de Greenwich', () => {
    expect(lngLatToPixel(-180, 0, 0)).toEqual([0, 128]);
    const [x, y] = lngLatToPixel(0, 0, 9);
    expect(x).toBeCloseTo(65536, 6);
    expect(y).toBeCloseTo(65536, 6);
  });

  it('couvre l’emprise de travail avec une tuile de marge', () => {
    const range = tileRange(GRID_SPEC, TERRARIUM_ZOOM);
    expect(range).toMatchObject({ zoom: 9 });
    // Paris (tuile 259/176 au zoom 9) et Ajaccio sont couverts.
    expect(range.minX).toBeLessThanOrEqual(247);
    expect(range.maxX).toBeGreaterThanOrEqual(270);
    expect(range.minY).toBeLessThanOrEqual(171);
    expect(range.maxY).toBeGreaterThanOrEqual(190);
    expect(tileUrl('https://tuiles.test/terrarium', 9, 259, 176)).toBe(
      'https://tuiles.test/terrarium/9/259/176.png',
    );
  });

  it('borne la plage aux tuiles existantes', () => {
    const world: ElevationGridSpec = {
      west: -180,
      north: 85,
      dlon: 1,
      dlat: 1,
      cols: 360,
      rows: 170,
    };
    expect(tileRange(world, 0)).toEqual({ zoom: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 });
  });
});

describe('décodage Terrarium', () => {
  it('applique la formule de référence', () => {
    // Valeur de contrôle de la documentation : rgb(137, 219, 68) = 2523,265625 m.
    expect(decodeTerrarium(Uint8Array.from([137, 219, 68, 255]))[0]).toBeCloseTo(2523.265625, 6);
    expect(decodeTerrarium(Uint8Array.from([128, 0, 0, 255]))[0]).toBe(0);
  });
});

describe('rééchantillonnage', () => {
  // Petite grille au cœur de la tuile 259/176 (Paris) au zoom 9.
  const spec: ElevationGridSpec = {
    west: 2.3,
    north: 48.9,
    dlon: 0.01,
    dlat: 0.01,
    cols: 4,
    rows: 3,
  };

  it('restitue un relief constant et marque l’absence de tuile', () => {
    const store: TileStore = new Map([['259/176', new Float32Array(256 * 256).fill(42.4)]]);
    expect([...resample(store, spec, 9)]).toEqual(new Array(12).fill(42));
    expect([...resample(new Map(), spec, 9)]).toEqual(new Array(12).fill(ELEVATION_NODATA));
  });

  it('interpole une pente régulière et produit une grille lisible par le moteur', () => {
    // Altitude proportionnelle à la colonne de pixel : croissante vers l'est.
    const slope = new Float32Array(256 * 256).map((_, i) => (i % 256) * 2);
    const store: TileStore = new Map([['259/176', slope]]);
    const grid = ElevationGrid.decode(buildElevationGrid(store, spec, 9));
    const west = grid.sample([2.305, 48.895]) ?? NaN;
    const east = grid.sample([2.335, 48.895]) ?? NaN;
    expect(east).toBeGreaterThan(west);
    expect(grid.spec).toEqual(spec);
  });

  it('écrête les valeurs hors de la plage int16', () => {
    const store: TileStore = new Map([['259/176', new Float32Array(256 * 256).fill(40000)]]);
    expect(resample(store, spec, 9)[0]).toBe(32767);
  });
});

describe('lecture des tuiles PNG', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'trains-tiles-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('décode les PNG Terrarium', async () => {
    const path = join(dir, 'ok.png');
    await writeFile(
      path,
      terrariumPng((px) => px - 100),
    );
    const store = await loadTiles([{ x: 1, y: 2, path }]);
    const tile = store.get('1/2');
    expect(tile?.[0]).toBeCloseTo(-100, 2);
    expect(tile?.[255]).toBeCloseTo(155, 2);
  });

  it('refuse une tuile de taille inattendue', async () => {
    const path = join(dir, 'petite.png');
    await writeFile(
      path,
      terrariumPng(() => 0, 64),
    );
    await expect(loadTiles([{ x: 0, y: 0, path }])).rejects.toThrow(/64×64/);
  });
});
