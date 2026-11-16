/**
 * Grille d'altitude compacte (≈ 250 m) utilisée pour les pentes, le profil en
 * long et les coûts. Produite par packages/data, lue ici à l'identique dans
 * le navigateur et sur le serveur.
 *
 * Format binaire (petit-boutiste) :
 *   0   8 o  signature « RDFELEV1 »
 *   8   4 o  colonnes (uint32)
 *   12  4 o  lignes (uint32)
 *   16  8 o  longitude du bord ouest (float64)
 *   24  8 o  latitude du bord nord (float64)
 *   32  8 o  pas en longitude, degrés (float64)
 *   40  8 o  pas en latitude, degrés (float64)
 *   48  2 o  valeur « sans donnée » (int16)
 *   50 14 o  réservé (zéros)
 *   64       altitudes en mètres, int16, ligne par ligne du nord au sud
 *
 * Chaque valeur est l'altitude au centre de sa cellule. Une grille
 * géographique régulière (et non projetée) garde la lecture triviale.
 */

import type { LngLat } from './geo.ts';

export const ELEVATION_MAGIC = 'RDFELEV1';
export const ELEVATION_HEADER_BYTES = 64;
export const ELEVATION_NODATA = -32768;

export interface ElevationGridSpec {
  cols: number;
  rows: number;
  west: number;
  north: number;
  dlon: number;
  dlat: number;
}

export class ElevationFormatError extends Error {
  constructor(message: string) {
    super(`Grille d'altitude invalide : ${message}`);
    this.name = 'ElevationFormatError';
  }
}

export function encodeElevationGrid(spec: ElevationGridSpec, values: Int16Array): Uint8Array {
  if (values.length !== spec.cols * spec.rows) {
    throw new ElevationFormatError(
      `${values.length} valeurs pour ${spec.cols}×${spec.rows} cellules`,
    );
  }
  const buffer = new ArrayBuffer(ELEVATION_HEADER_BYTES + values.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < ELEVATION_MAGIC.length; i++) view.setUint8(i, ELEVATION_MAGIC.charCodeAt(i));
  view.setUint32(8, spec.cols, true);
  view.setUint32(12, spec.rows, true);
  view.setFloat64(16, spec.west, true);
  view.setFloat64(24, spec.north, true);
  view.setFloat64(32, spec.dlon, true);
  view.setFloat64(40, spec.dlat, true);
  view.setInt16(48, ELEVATION_NODATA, true);
  // Écriture explicite en petit-boutiste, indépendante de la plateforme.
  for (let i = 0; i < values.length; i++) {
    view.setInt16(ELEVATION_HEADER_BYTES + i * 2, values[i] as number, true);
  }
  return new Uint8Array(buffer);
}

export class ElevationGrid {
  readonly spec: ElevationGridSpec;
  private readonly values: Int16Array;

  private constructor(spec: ElevationGridSpec, values: Int16Array) {
    this.spec = spec;
    this.values = values;
  }

  static decode(bytes: Uint8Array): ElevationGrid {
    if (bytes.byteLength < ELEVATION_HEADER_BYTES)
      throw new ElevationFormatError('en-tête tronqué');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = String.fromCharCode(...bytes.subarray(0, ELEVATION_MAGIC.length));
    if (magic !== ELEVATION_MAGIC) throw new ElevationFormatError(`signature « ${magic} »`);
    const spec: ElevationGridSpec = {
      cols: view.getUint32(8, true),
      rows: view.getUint32(12, true),
      west: view.getFloat64(16, true),
      north: view.getFloat64(24, true),
      dlon: view.getFloat64(32, true),
      dlat: view.getFloat64(40, true),
    };
    const count = spec.cols * spec.rows;
    if (spec.cols === 0 || spec.rows === 0 || !(spec.dlon > 0) || !(spec.dlat > 0)) {
      throw new ElevationFormatError('dimensions nulles');
    }
    if (bytes.byteLength !== ELEVATION_HEADER_BYTES + count * 2) {
      throw new ElevationFormatError(`${bytes.byteLength} octets pour ${count} cellules`);
    }
    const values = new Int16Array(count);
    for (let i = 0; i < count; i++) values[i] = view.getInt16(ELEVATION_HEADER_BYTES + i * 2, true);
    return new ElevationGrid(spec, values);
  }

  static fromValues(spec: ElevationGridSpec, values: Int16Array): ElevationGrid {
    return ElevationGrid.decode(encodeElevationGrid(spec, values));
  }

  private at(col: number, row: number): number | null {
    const value = this.values[row * this.spec.cols + col] as number;
    return value === ELEVATION_NODATA ? null : value;
  }

  /**
   * Altitude interpolée (bilinéaire) en mètres, ou `null` hors grille ou sans
   * donnée. Les bords sont prolongés d'une demi-cellule.
   */
  sample([lng, lat]: LngLat): number | null {
    const { cols, rows, west, north, dlon, dlat } = this.spec;
    // Coordonnées continues dans la grille, les centres étant aux demi-entiers.
    const x = (lng - west) / dlon - 0.5;
    const y = (north - lat) / dlat - 0.5;
    // Tolérance minime : un point exactement sur le bord ne doit pas sortir
    // de la grille à cause d'un arrondi flottant.
    const eps = 1e-9;
    if (x < -0.5 - eps || y < -0.5 - eps || x > cols - 0.5 + eps || y > rows - 0.5 + eps) {
      return null;
    }
    const cx = Math.min(Math.max(x, 0), cols - 1);
    const cy = Math.min(Math.max(y, 0), rows - 1);
    const c0 = Math.floor(cx);
    const r0 = Math.floor(cy);
    const c1 = Math.min(c0 + 1, cols - 1);
    const r1 = Math.min(r0 + 1, rows - 1);
    const fx = cx - c0;
    const fy = cy - r0;
    const corners = [this.at(c0, r0), this.at(c1, r0), this.at(c0, r1), this.at(c1, r1)];
    const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    // Les coins sans donnée (mer, hors couverture) sont écartés et les poids
    // renormalisés : une côte reste lisible sans tirer les terres vers -32768.
    let sum = 0;
    let weight = 0;
    corners.forEach((value, i) => {
      if (value === null) return;
      sum += value * (weights[i] as number);
      weight += weights[i] as number;
    });
    return weight > 0 ? sum / weight : null;
  }
}
