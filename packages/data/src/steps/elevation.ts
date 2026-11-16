import { readFile } from 'node:fs/promises';
import { ELEVATION_NODATA, encodeElevationGrid, type ElevationGridSpec } from '@trains/engine';
import { DATA_BBOX } from '@trains/shared';
import { PNG } from 'pngjs';

/**
 * Tuiles Terrarium (Web Mercator, 256 px). Au zoom 9, un pixel couvre 200 à
 * 230 m en France : la bonne finesse pour une grille d'environ 250 m.
 */
export const TERRARIUM_ZOOM = 9;
const TILE_SIZE = 256;

/** Grille cible : 1/450° en latitude (≈ 247 m), 1/320° en longitude (≈ 241 m à 46° N). */
export const GRID_SPEC: ElevationGridSpec = {
  west: DATA_BBOX.west,
  north: DATA_BBOX.north,
  dlon: 1 / 320,
  dlat: 1 / 450,
  cols: Math.round((DATA_BBOX.east - DATA_BBOX.west) * 320),
  rows: Math.round((DATA_BBOX.north - DATA_BBOX.south) * 450),
};

/** Coordonnées « pixel monde » Web Mercator au zoom donné. */
export function lngLatToPixel(lng: number, lat: number, zoom: number): [number, number] {
  const scale = TILE_SIZE * 2 ** zoom;
  const phi = (lat * Math.PI) / 180;
  const x = ((lng + 180) / 360) * scale;
  const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * scale;
  return [x, y];
}

export interface TileRange {
  zoom: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Tuiles couvrant l'emprise de la grille (une tuile de marge pour l'interpolation). */
export function tileRange(spec: ElevationGridSpec, zoom: number): TileRange {
  const east = spec.west + spec.cols * spec.dlon;
  const south = spec.north - spec.rows * spec.dlat;
  const [x0, y0] = lngLatToPixel(spec.west, spec.north, zoom);
  const [x1, y1] = lngLatToPixel(east, south, zoom);
  const max = 2 ** zoom - 1;
  return {
    zoom,
    minX: Math.max(0, Math.floor(x0 / TILE_SIZE) - 1),
    maxX: Math.min(max, Math.floor(x1 / TILE_SIZE) + 1),
    minY: Math.max(0, Math.floor(y0 / TILE_SIZE) - 1),
    maxY: Math.min(max, Math.floor(y1 / TILE_SIZE) + 1),
  };
}

export function tileUrl(base: string, zoom: number, x: number, y: number): string {
  return `${base}/${zoom}/${x}/${y}.png`;
}

/** Altitude Terrarium : (R × 256 + G + B / 256) − 32768, en mètres. */
export function decodeTerrarium(rgba: Uint8Array): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    const r = rgba[i * 4] as number;
    const g = rgba[i * 4 + 1] as number;
    const b = rgba[i * 4 + 2] as number;
    out[i] = r * 256 + g + b / 256 - 32768;
  }
  return out;
}

export type TileStore = Map<string, Float32Array>;
const tileKey = (x: number, y: number): string => `${x}/${y}`;

export async function loadTiles(
  tiles: readonly { x: number; y: number; path: string }[],
): Promise<TileStore> {
  const store: TileStore = new Map();
  for (const tile of tiles) {
    const png = PNG.sync.read(await readFile(tile.path));
    if (png.width !== TILE_SIZE || png.height !== TILE_SIZE) {
      throw new Error(`Tuile ${tile.x}/${tile.y} : ${png.width}×${png.height} px inattendu`);
    }
    store.set(tileKey(tile.x, tile.y), decodeTerrarium(png.data));
  }
  return store;
}

function pixel(store: TileStore, px: number, py: number): number | null {
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  const tile = store.get(tileKey(tx, ty));
  if (!tile) return null;
  return tile[(py - ty * TILE_SIZE) * TILE_SIZE + (px - tx * TILE_SIZE)] ?? null;
}

/**
 * Rééchantillonne les tuiles sur la grille géographique (interpolation
 * bilinéaire entre centres de pixels), en mètres arrondis.
 */
export function resample(store: TileStore, spec: ElevationGridSpec, zoom: number): Int16Array {
  const values = new Int16Array(spec.cols * spec.rows);
  for (let row = 0; row < spec.rows; row++) {
    const lat = spec.north - (row + 0.5) * spec.dlat;
    for (let col = 0; col < spec.cols; col++) {
      const lng = spec.west + (col + 0.5) * spec.dlon;
      const [fx, fy] = lngLatToPixel(lng, lat, zoom);
      const x = fx - 0.5;
      const y = fy - 0.5;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const ax = x - x0;
      const ay = y - y0;
      const p00 = pixel(store, x0, y0);
      const p10 = pixel(store, x0 + 1, y0);
      const p01 = pixel(store, x0, y0 + 1);
      const p11 = pixel(store, x0 + 1, y0 + 1);
      if (p00 === null || p10 === null || p01 === null || p11 === null) {
        values[row * spec.cols + col] = ELEVATION_NODATA;
        continue;
      }
      const v = (p00 * (1 - ax) + p10 * ax) * (1 - ay) + (p01 * (1 - ax) + p11 * ax) * ay;
      values[row * spec.cols + col] = Math.max(-32767, Math.min(32767, Math.round(v)));
    }
  }
  return values;
}

export function buildElevationGrid(
  store: TileStore,
  spec = GRID_SPEC,
  zoom = TERRARIUM_ZOOM,
): Uint8Array {
  return encodeElevationGrid(spec, resample(store, spec, zoom));
}
