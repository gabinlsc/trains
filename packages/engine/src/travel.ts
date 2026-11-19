/**
 * Marches types : temps de parcours d'un train entre deux arrêts, à partir
 * des vitesses limites le long du tracé et des performances du matériel.
 *
 * Méthode classique en deux passes sur une discrétisation du parcours :
 * la passe avant applique l'accélération (bornée par la puissance), la passe
 * arrière la décélération de service ; la vitesse retenue est le minimum des
 * deux et de la limite. Les déclivités et la résistance à l'avancement sont
 * négligées : une marge de régularité les couvre, comme dans les horaires
 * réels.
 */
import type { RollingStock } from '@trains/shared';
import { maxSpeedForRadius } from './alignment.ts';
import { circumradius, haversineDistance, type LngLat } from './geo.ts';

/** Morceau homogène d'un parcours : un tracé et la vitesse permise par la voie et le train. */
export interface RunPiece {
  path: readonly LngLat[];
  /** Vitesse permise (km/h) : compatibilité du matériel avec le tronçon. */
  speedKmh: number;
}

export interface SpeedSample {
  distance: number;
  /** Vitesse limite et vitesse pratiquée (km/h). */
  limitKmh: number;
  speedKmh: number;
}

export interface LegRun {
  lengthM: number;
  /** Temps de marche pur, sans marge ni arrêt (s). */
  runningS: number;
  profile: SpeedSample[];
}

/** Marge de régularité ajoutée aux temps de marche (part du temps pur). */
export const REGULARITY_MARGIN = 0.05;

/** Temps d'arrêt en gare (s) selon le type de gare. */
export const DWELL_S = { halte: 45, gare: 90, correspondance: 150, tgv: 180 } as const;

const KMH = 3.6;

/**
 * Accélération disponible à une vitesse donnée (m/s²) : l'adhérence la borne
 * au démarrage, la puissance ensuite (a = P / (m·v)).
 */
export function availableAcceleration(stock: RollingStock, speedMs: number): number {
  const powerLimited = (stock.powerKw * 1000) / (stock.massT * 1000 * Math.max(speedMs, 0.1));
  return Math.min(stock.accelerationMs2, powerLimited);
}

/**
 * Vitesses limites le long d'un parcours (pas `stepM`) : celle du morceau,
 * réduite dans les courbes au rayon local. Le train étant long, la limite
 * d'une courbe s'applique sur toute sa longueur (on retient la plus faible
 * sur la longueur du train).
 */
export function speedLimits(
  pieces: readonly RunPiece[],
  trainLengthM = 0,
  stepM = 25,
): { distance: number[]; limit: number[] } {
  // Points du parcours, avec la limite propre à chaque point.
  const points: { at: number; limit: number }[] = [];
  let travelled = 0;
  for (const piece of pieces) {
    const path = piece.path;
    for (let i = 0; i < path.length; i++) {
      const p = path[i] as LngLat;
      if (i > 0) travelled += haversineDistance(path[i - 1] as LngLat, p);
      let limit = piece.speedKmh;
      if (i > 0 && i < path.length - 1) {
        const radius = circumradius(path[i - 1] as LngLat, p, path[i + 1] as LngLat);
        limit = Math.min(limit, maxSpeedForRadius(radius));
      }
      points.push({ at: travelled, limit });
    }
  }
  const total = travelled;
  const n = Math.max(2, Math.ceil(total / stepM) + 1);
  const distance: number[] = [];
  const raw: number[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const d = (total * k) / (n - 1);
    distance.push(d);
    // Limite du point de tracé le plus proche en amont.
    while (j < points.length - 1 && (points[j + 1] as { at: number }).at <= d) j++;
    const here = points[j]?.limit ?? 0;
    const next = points[Math.min(j + 1, points.length - 1)]?.limit ?? here;
    raw.push(Math.min(here, next));
  }
  if (trainLengthM <= 0) return { distance, limit: raw };
  // Fenêtre glissante : la queue du train sort de la courbe après la tête.
  const span = Math.max(1, Math.round(trainLengthM / (total / (n - 1) || 1)));
  const limit = raw.map((_, k) => {
    let min = Infinity;
    for (let w = Math.max(0, k - span); w <= k; w++) min = Math.min(min, raw[w] as number);
    return min;
  });
  return { distance, limit };
}

/** Marche d'un train arrêté au départ et à l'arrivée. */
export function runLeg(pieces: readonly RunPiece[], stock: RollingStock, stepM = 25): LegRun {
  const { distance, limit } = speedLimits(pieces, stock.lengthM, stepM);
  const n = distance.length;
  const cap = limit.map((v) => Math.min(v, stock.maxSpeedKmh) / KMH);
  const forward = new Array<number>(n).fill(0);
  for (let k = 1; k < n; k++) {
    const ds = (distance[k] as number) - (distance[k - 1] as number);
    const v = forward[k - 1] as number;
    const reachable = Math.sqrt(v * v + 2 * availableAcceleration(stock, v) * ds);
    forward[k] = Math.min(cap[k] as number, reachable);
  }
  forward[n - 1] = 0;
  const speed = [...forward];
  for (let k = n - 2; k >= 0; k--) {
    const ds = (distance[k + 1] as number) - (distance[k] as number);
    const v = speed[k + 1] as number;
    speed[k] = Math.min(speed[k] as number, Math.sqrt(v * v + 2 * stock.decelerationMs2 * ds));
  }
  speed[0] = 0;
  let runningS = 0;
  for (let k = 1; k < n; k++) {
    const ds = (distance[k] as number) - (distance[k - 1] as number);
    const mean = ((speed[k - 1] as number) + (speed[k] as number)) / 2;
    // Au démarrage, la vitesse moyenne nulle se traite par la cinématique.
    runningS += mean > 0 ? ds / mean : Math.sqrt((2 * ds) / stock.accelerationMs2);
  }
  return {
    lengthM: distance[n - 1] ?? 0,
    runningS,
    profile: distance.map((d, k) => ({
      distance: d,
      limitKmh: (cap[k] as number) * KMH,
      speedKmh: (speed[k] as number) * KMH,
    })),
  };
}

export interface TimetableStop {
  /** Arrivée et départ, en secondes depuis le départ du terminus. */
  arrivalS: number;
  departureS: number;
}

/**
 * Horaire d'un train : marches des intervalles, marge de régularité, arrêts
 * aux gares intermédiaires selon leur type.
 */
export function timetable(
  legs: readonly { runningS: number }[],
  dwellS: readonly number[],
  margin = REGULARITY_MARGIN,
): { stops: TimetableStop[]; totalS: number } {
  const stops: TimetableStop[] = [{ arrivalS: 0, departureS: 0 }];
  let clock = 0;
  legs.forEach((leg, i) => {
    clock += leg.runningS * (1 + margin);
    const isLast = i === legs.length - 1;
    const dwell = isLast ? 0 : (dwellS[i + 1] ?? 0);
    stops.push({ arrivalS: clock, departureS: clock + dwell });
    clock += dwell;
  });
  return { stops, totalS: (stops.at(-1) as TimetableStop).arrivalS };
}

/** Battement minimal au terminus avant le retour (s). */
export const TURNAROUND_S = 10 * 60;

/**
 * Rames nécessaires pour tenir la cadence : un aller-retour avec ses
 * battements, divisé par l'intervalle entre deux départs.
 */
export function fleetSize(tripS: number, headwayMin: number, turnaroundS = TURNAROUND_S): number {
  const cycle = 2 * (tripS + turnaroundS);
  return Math.max(1, Math.ceil(cycle / (headwayMin * 60)));
}
