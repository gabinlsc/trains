import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { decodeTerrarium, type TileStore } from '../src/steps/elevation.ts';
import {
  buildReliefPyramid,
  downsample,
  encodeTerrarium,
  RELIEF_MAX_ZOOM,
  RELIEF_MIN_ZOOM,
  reliefFiles,
} from '../src/steps/relief.ts';

const SIZE = 256;
const constant = (value: number) => new Float32Array(SIZE * SIZE).fill(value);

describe('encodeTerrarium', () => {
  it('réencode des altitudes relues à l’identique, au 1/256 de mètre près', () => {
    const heights = new Float32Array(SIZE * SIZE).map((_, i) => (i % 5000) - 400 + 0.5);
    const png = PNG.sync.read(encodeTerrarium(heights));
    const decoded = decodeTerrarium(png.data);
    for (const i of [0, 1, 4999, 12345, SIZE * SIZE - 1]) {
      expect(decoded[i]).toBeCloseTo(heights[i] as number, 2);
    }
  });

  it('borne les valeurs hors plage', () => {
    const decoded = decodeTerrarium(PNG.sync.read(encodeTerrarium(constant(-40000))).data);
    expect(decoded[0]).toBe(-32768);
  });
});

describe('downsample', () => {
  it('moyenne les blocs 2 × 2 de la mosaïque des quatre enfants', () => {
    const children: TileStore = new Map([
      ['0/0', constant(100)],
      ['1/0', constant(200)],
      ['0/1', constant(300)],
      ['1/1', constant(400)],
    ]);
    const parent = downsample(children, 0, 0) as Float32Array;
    expect(parent[0]).toBe(100);
    expect(parent[SIZE - 1]).toBe(200);
    expect(parent[(SIZE - 1) * SIZE]).toBe(300);
    expect(parent[SIZE * SIZE - 1]).toBe(400);
  });

  it('ignore les enfants absents et ne produit rien sans enfant', () => {
    const parent = downsample(new Map([['2/2', constant(50)]]), 1, 1) as Float32Array;
    expect(parent[0]).toBe(50);
    expect(parent[SIZE * SIZE - 1]).toBe(0);
    expect(downsample(new Map(), 3, 3)).toBeNull();
  });
});

describe('pyramide', () => {
  // Deux tuiles voisines au zoom 9 (Paris) : un seul parent à chaque niveau inférieur.
  const source: TileStore = new Map([
    ['259/176', constant(35)],
    ['258/176', constant(45)],
  ]);

  it('produit chaque zoom jusqu’au minimal', () => {
    const levels = buildReliefPyramid(source);
    expect([...levels.keys()].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9]);
    expect([...(levels.get(8) as TileStore).keys()]).toEqual(['129/88']);
    expect([...(levels.get(RELIEF_MIN_ZOOM) as TileStore).keys()]).toEqual(['16/11']);
  });

  it('nomme les fichiers z/x/y.png', () => {
    const paths = reliefFiles(source)
      .map((f) => f.path)
      .sort();
    expect(paths).toContain(`${RELIEF_MAX_ZOOM}/259/176.png`);
    expect(paths).toContain('5/16/11.png');
    expect(paths).toHaveLength(6);
  });
});
