/**
 * Profil en long : échantillonnage d'un tracé, ligne rouge (cote de la voie)
 * et ouvrages d'art proposés là où la voie s'écarte trop du terrain.
 */
import type { ElevationGrid } from './elevation.ts';
import { haversineDistance, type LngLat } from './geo.ts';

export interface ProfileSample {
  /** Abscisse curviligne depuis le début du tracé (m). */
  distance: number;
  /** Altitude du terrain (m), ou null hors grille. */
  elevation: number | null;
  position: LngLat;
}

/**
 * Points régulièrement espacés le long d'une polyligne (premier et dernier
 * point inclus), avec l'altitude du terrain lue dans la grille.
 */
export function sampleProfile(
  points: readonly LngLat[],
  grid: ElevationGrid,
  stepM = 100,
): ProfileSample[] {
  if (points.length === 0) return [];
  const samples: ProfileSample[] = [];
  const push = (position: LngLat, distance: number): void => {
    samples.push({ distance, elevation: grid.sample(position), position });
  };
  push(points[0] as LngLat, 0);
  let travelled = 0;
  let next = stepM;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as LngLat;
    const b = points[i] as LngLat;
    const length = haversineDistance(a, b);
    while (next < travelled + length) {
      const t = (next - travelled) / length;
      push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], next);
      next += stepM;
    }
    travelled += length;
  }
  const last = points[points.length - 1] as LngLat;
  if (points.length > 1 && travelled - (samples.at(-1)?.distance ?? 0) > 1e-6)
    push(last, travelled);
  return samples;
}

/** Résolution verticale de la ligne rouge (m). */
const LEVEL_STEP_M = 0.5;

/**
 * Au-delà de cette hauteur, un remblai devient un viaduc et une tranchée un
 * tunnel : ordre de grandeur courant des terrassements ferroviaires.
 */
export const EARTHWORK_LIMIT_M = 15;

/**
 * Coût d'un écart voie/terrain. Jusqu'à la limite des terrassements, il
 * croît avec la hauteur ; au-delà, un ouvrage coûte surtout par sa longueur,
 * presque pas par sa hauteur. L'optimum franchit donc une vallée au niveau
 * du plateau et passe une crête en tunnel, sans entailler les plaines
 * voisines pour « équilibrer » déblais et remblais.
 */
export function gapCost(gap: number): number {
  const g = Math.abs(gap);
  return g <= EARTHWORK_LIMIT_M ? g : EARTHWORK_LIMIT_M + 0.05 * (g - EARTHWORK_LIMIT_M);
}

/**
 * Ligne rouge : cote de la voie qui respecte la rampe maximale en minimisant
 * la somme des coûts d'écart au terrain (`gapCost`). Elle suit le terrain
 * partout où il est conforme et concentre les écarts dans les ouvrages.
 *
 * Programmation dynamique sur des cotes discrètes : à chaque point, le coût
 * d'une cote est son écart au terrain plus le meilleur coût atteignable au
 * point précédent sans dépasser la rampe. Le minimum sur la fenêtre de cotes
 * accessibles se calcule par file monotone, d'où un coût linéaire en nombre
 * de cotes. Les points hors grille reprennent l'altitude connue précédente.
 */
export function gradeLine(
  distance: readonly number[],
  terrain: readonly (number | null)[],
  maxGradePermille: number,
): number[] {
  const n = distance.length;
  if (n === 0) return [];
  const filled: number[] = [];
  let lastKnown = terrain.find((z): z is number => z !== null) ?? 0;
  for (const z of terrain) {
    if (z !== null) lastKnown = z;
    filled.push(lastKnown);
  }
  const low = Math.min(...filled);
  const levels = Math.max(1, Math.ceil((Math.max(...filled) - low) / LEVEL_STEP_M) + 1);
  const g = maxGradePermille / 1000;

  let cost = new Float64Array(levels);
  for (let l = 0; l < levels; l++)
    cost[l] = gapCost(low + l * LEVEL_STEP_M - (filled[0] as number));
  const choice: Int32Array[] = [];
  const deque = new Int32Array(levels);

  for (let i = 1; i < n; i++) {
    const reach = Math.floor(
      (g * ((distance[i] as number) - (distance[i - 1] as number))) / LEVEL_STEP_M + 1e-9,
    );
    const next = new Float64Array(levels);
    const from = new Int32Array(levels);
    // Minimum de cost sur [l - reach, l + reach], fenêtre glissante.
    let head = 0;
    let tail = 0;
    let right = 0;
    for (let l = 0; l < levels; l++) {
      while (right < levels && right <= l + reach) {
        while (
          tail > head &&
          (cost[deque[tail - 1] as number] as number) >= (cost[right] as number)
        )
          tail--;
        deque[tail++] = right++;
      }
      while ((deque[head] as number) < l - reach) head++;
      const best = deque[head] as number;
      from[l] = best;
      next[l] = (cost[best] as number) + gapCost(low + l * LEVEL_STEP_M - (filled[i] as number));
    }
    choice.push(from);
    cost = next;
  }

  let level = 0;
  for (let l = 1; l < levels; l++) if ((cost[l] as number) < (cost[level] as number)) level = l;
  const track = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    track[i] = low + level * LEVEL_STEP_M;
    if (i > 0) level = (choice[i - 1] as Int32Array)[level] as number;
  }
  return track;
}

export type StructureKind = 'tunnel' | 'viaduct';

export interface ProposedStructure {
  kind: StructureKind;
  from: number;
  to: number;
  /** Écart maximal voie/terrain sur l'ouvrage (m). */
  depth: number;
}

/**
 * Ouvrages proposés : tronçons continus où la voie passe à plus de
 * `limit` mètres sous le terrain (tunnel) ou au-dessus (viaduc). Les
 * ouvrages trop courts (moins de 100 m) sont ignorés : un déblai ou un
 * remblai localement plus profond suffit.
 */
export function proposeStructures(
  distance: readonly number[],
  terrain: readonly number[],
  track: readonly number[],
  limit = EARTHWORK_LIMIT_M,
  minLength = 100,
): ProposedStructure[] {
  // Séries consécutives de même nature (tunnel, viaduc ou rien).
  const runs: { kind: StructureKind | null; from: number; to: number; depth: number }[] = [];
  for (let i = 0; i < distance.length; i++) {
    const gap = (track[i] as number) - (terrain[i] as number);
    const kind: StructureKind | null = gap < -limit ? 'tunnel' : gap > limit ? 'viaduct' : null;
    const d = distance[i] as number;
    const last = runs.at(-1);
    if (last?.kind === kind) {
      last.to = d;
      last.depth = Math.max(last.depth, Math.abs(gap));
    } else {
      runs.push({ kind, from: d, to: d, depth: Math.abs(gap) });
    }
  }
  return runs
    .filter((r): r is ProposedStructure => r.kind !== null && r.to - r.from >= minLength)
    .map(({ kind, from, to, depth }) => ({ kind, from, to, depth }));
}
