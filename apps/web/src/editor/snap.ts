import type { Id, Position } from '@trains/shared';

/**
 * Cible d'aimantation : un nœud du réseau, une gare réelle à reprendre, ou
 * un point d'un tronçon existant (y aboutir crée une bifurcation).
 */
export type SnapTarget =
  | { kind: 'node'; id: Id; position: Position; label: string }
  | { kind: 'station'; uic: string; position: Position; label: string }
  | { kind: 'segment'; id: Id; position: Position; label: string };

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Distance d'aimantation, en pixels : assez large au doigt, assez fine à la souris. */
export const SNAP_RADIUS_PX = 14;

/**
 * Cible la plus proche du pointeur dans le rayon d'aimantation. À distance
 * égale, un nœud existant l'emporte sur une gare réelle : raccorder au réseau
 * du joueur est l'intention la plus fréquente.
 */
export function findSnap(
  pointer: ScreenPoint,
  candidates: readonly SnapTarget[],
  project: (position: Position) => ScreenPoint,
  radius = SNAP_RADIUS_PX,
): SnapTarget | null {
  let best: SnapTarget | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const p = project(candidate.position);
    const d = Math.hypot(p.x - pointer.x, p.y - pointer.y);
    if (d > radius) continue;
    const score = d + (candidate.kind === 'node' ? 0 : 0.5);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
