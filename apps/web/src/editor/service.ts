import {
  compatibility,
  DWELL_S,
  fleetSize,
  lineRoute,
  runLeg,
  timetable,
  type LineRoute,
  type RunPiece,
  type TimetableStop,
} from '@trains/engine';
import { departuresPerDay, rollingStockById, type Line, type Network } from '@trains/shared';
import { smoothedPath } from './geometry.ts';

export interface LineService {
  route: LineRoute;
  /** Horaire d'un train de bout en bout, ou null si la ligne n'est pas circulable. */
  stops: TimetableStop[] | null;
  tripS: number | null;
  averageKmh: number | null;
  fleet: number | null;
  /** Prix d'achat du parc (M€) et exploitation annuelle (M€/an). */
  fleetCostM: number | null;
  operatingCostM: number | null;
}

const DAYS_PER_YEAR = 365;

/**
 * Exploitation d'une ligne : marches de chaque intervalle avec le matériel
 * choisi, horaire, parc nécessaire et coût d'exploitation. Une ligne dont un
 * intervalle n'est pas relié, ou dont le matériel ne passe pas partout,
 * n'a pas d'horaire.
 */
export function analyseLine(network: Network, line: Line): LineService {
  const route = lineRoute(network, line);
  const stock = rollingStockById(line.stock);
  const none: LineService = {
    route,
    stops: null,
    tripS: null,
    averageKmh: null,
    fleet: null,
    fleetCostM: null,
    operatingCostM: null,
  };
  if (!route.ok || !stock) return none;
  const legs = [];
  for (const leg of route.legs) {
    if (!leg) return none;
    const pieces: RunPiece[] = [];
    for (const step of leg.steps) {
      const segment = network.segments[step.segment];
      if (!segment) return none;
      const allowed = compatibility(stock, segment.spec);
      if (!allowed.ok) return none;
      const path = smoothedPath(network, segment);
      pieces.push({ path: step.reversed ? [...path].reverse() : path, speedKmh: allowed.speedKmh });
    }
    legs.push(runLeg(pieces, stock, 50));
  }
  const dwell = line.stops.map((id) => {
    const type = network.nodes[id]?.station?.type;
    return type ? DWELL_S[type] : 0;
  });
  const { stops, totalS } = timetable(legs, dwell);
  const fleet = fleetSize(totalS, line.headwayMin);
  const trainKmPerYear = 2 * departuresPerDay(line) * (route.lengthM / 1000) * DAYS_PER_YEAR;
  return {
    route,
    stops,
    tripS: totalS,
    averageKmh: totalS > 0 ? route.lengthM / 1000 / (totalS / 3600) : null,
    fleet,
    fleetCostM: fleet * stock.priceM,
    operatingCostM: (trainKmPerYear * stock.costPerTrainKm) / 1e6,
  };
}

/** Durée lisible : « 1 h 05 » ou « 42 min ». */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** Heure de passage d'un train parti à `departureMin` : « 07:42 ». */
export function clockTime(departureMin: number, offsetS: number): string {
  const total = Math.round(departureMin + offsetS / 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
