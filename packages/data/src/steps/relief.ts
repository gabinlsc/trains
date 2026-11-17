import { PNG } from 'pngjs';
import type { TileStore } from './elevation.ts';

/**
 * Tuiles d'altitude au format Terrarium pour l'ombrage du relief et les
 * courbes de niveau, calculés par le navigateur. Le zoom 9 reprend les
 * tuiles source ; les zooms inférieurs sont obtenus par moyenne 2 × 2.
 */
export const RELIEF_MIN_ZOOM = 5;
export const RELIEF_MAX_ZOOM = 9;
const SIZE = 256;

/** Encodage Terrarium : v = h + 32768, R = ⌊v / 256⌋, G = ⌊v⌋ mod 256, B = fraction × 256. */
export function encodeTerrarium(heights: Float32Array): Buffer {
  const png = new PNG({ width: SIZE, height: SIZE });
  for (let i = 0; i < heights.length; i++) {
    const v = Math.min(65535.99, Math.max(0, (heights[i] as number) + 32768));
    const whole = Math.floor(v);
    png.data[i * 4] = whole >> 8;
    png.data[i * 4 + 1] = whole & 0xff;
    png.data[i * 4 + 2] = Math.floor((v - whole) * 256);
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png, { colorType: 2 });
}

const key = (x: number, y: number): string => `${x}/${y}`;

/**
 * Tuile parente : chaque pixel est la moyenne du bloc 2 × 2 correspondant
 * dans la mosaïque de ses quatre enfants. Un enfant absent (hors emprise)
 * est ignoré ; une tuile sans aucun enfant n'est pas produite.
 */
export function downsample(children: TileStore, x: number, y: number): Float32Array | null {
  const quads = [0, 1, 2, 3].map((i) => children.get(key(2 * x + (i % 2), 2 * y + (i >> 1))));
  if (quads.every((q) => q === undefined)) return null;
  const out = new Float32Array(SIZE * SIZE);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const qx = px >= SIZE / 2 ? 1 : 0;
      const qy = py >= SIZE / 2 ? 1 : 0;
      const quad = quads[qy * 2 + qx];
      if (!quad) continue;
      const cx = (px % (SIZE / 2)) * 2;
      const cy = (py % (SIZE / 2)) * 2;
      out[py * SIZE + px] =
        ((quad[cy * SIZE + cx] as number) +
          (quad[cy * SIZE + cx + 1] as number) +
          (quad[(cy + 1) * SIZE + cx] as number) +
          (quad[(cy + 1) * SIZE + cx + 1] as number)) /
        4;
    }
  }
  return out;
}

/** Pyramide complète, du zoom maximal (tuiles source) au zoom minimal. */
export function buildReliefPyramid(source: TileStore): Map<number, TileStore> {
  const levels = new Map<number, TileStore>([[RELIEF_MAX_ZOOM, source]]);
  for (let z = RELIEF_MAX_ZOOM - 1; z >= RELIEF_MIN_ZOOM; z--) {
    const children = levels.get(z + 1) as TileStore;
    const parents = new Set<string>();
    for (const k of children.keys()) {
      const [cx, cy] = k.split('/').map(Number) as [number, number];
      parents.add(key(cx >> 1, cy >> 1));
    }
    const level: TileStore = new Map();
    for (const k of parents) {
      const [x, y] = k.split('/').map(Number) as [number, number];
      const tile = downsample(children, x, y);
      if (tile) level.set(k, tile);
    }
    levels.set(z, level);
  }
  return levels;
}

export function reliefFiles(source: TileStore): { path: string; content: Buffer }[] {
  const files: { path: string; content: Buffer }[] = [];
  for (const [z, level] of buildReliefPyramid(source)) {
    for (const [k, heights] of level)
      files.push({ path: `${z}/${k}.png`, content: encodeTerrarium(heights) });
  }
  return files;
}
