import { DATA_BBOX } from '@trains/shared';

export type Position = [lng: number, lat: number];

/** 5 décimales ≈ 1 m : au-delà, on ne fait qu'alourdir les fichiers. */
export function roundCoord(value: number, decimals = 5): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function roundPosition([lng, lat]: readonly [number, number]): Position {
  return [roundCoord(lng), roundCoord(lat)];
}

export function inDataBbox([lng, lat]: readonly [number, number]): boolean {
  return (
    lng >= DATA_BBOX.west &&
    lng <= DATA_BBOX.east &&
    lat >= DATA_BBOX.south &&
    lat <= DATA_BBOX.north
  );
}

/**
 * Simplification de Douglas-Peucker en coordonnées géographiques, la
 * tolérance étant exprimée en degrés de latitude (1e-4 ≈ 11 m). Les
 * longitudes sont pondérées par cos(latitude) pour rester isotrope.
 */
export function simplifyLine(points: readonly Position[], tolerance: number): Position[] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);
  const first = points[0] as Position;
  const kx = Math.cos((first[1] * Math.PI) / 180);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;

  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    const a = points[start] as Position;
    const b = points[end] as Position;
    const dx = (b[0] - a[0]) * kx;
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let maxDist = -1;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i] as Position;
      const px = (p[0] - a[0]) * kx;
      const py = p[1] - a[1];
      let dist: number;
      if (len2 === 0) {
        dist = px * px + py * py;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        dist = ex * ex + ey * ey;
      }
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tol2) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i] === 1).map((p) => [p[0], p[1]]);
}
