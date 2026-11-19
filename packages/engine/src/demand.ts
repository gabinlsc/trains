/**
 * Demande voyageurs : modèle gravitaire, partage modal logit et affectation
 * sur les lignes du joueur.
 *
 * 1. Rabattement : chaque commune rejoint la gare desservie la plus proche,
 *    à moins de `ACCESS_RADIUS_M`. Une gare draine ainsi une population et un
 *    temps d'accès moyen.
 * 2. Génération et distribution : entre deux gares, le marché tous modes est
 *    proportionnel au produit des populations rabattues et décroît avec le
 *    carré de la distance (modèle gravitaire).
 * 3. Partage modal : un logit binaire compare le coût généralisé du train
 *    (accès, attente, trajet, correspondances, prix) à celui de la voiture.
 * 4. Affectation : les voyageurs du train suivent le chemin de coût minimal
 *    sur les lignes ; on en déduit la charge de chaque ligne, les montées en
 *    gare, les voyageurs-kilomètres et les recettes.
 *
 * Calcul pur et déterministe, prévu pour tourner dans un worker. Les
 * paramètres sont documentés dans docs/MODELE-ECONOMIQUE.md.
 */
import { haversineDistance, type LngLat } from './geo.ts';

export interface Zone {
  population: number;
  position: LngLat;
}

export interface DemandStation {
  id: string;
  position: LngLat;
}

export interface DemandLine {
  id: string;
  stops: readonly string[];
  /** Temps entre deux arrêts consécutifs, arrêts compris (s). */
  legTimesS: readonly number[];
  /** Longueur de chaque intervalle (m). */
  legLengthsM: readonly number[];
  headwayMin: number;
  /** Recette moyenne par voyageur-kilomètre (€). */
  farePerKm: number;
  /** Places offertes par jour et par sens. */
  dailyCapacity: number;
}

/** Rayon de rabattement autour d'une gare (m). */
export const ACCESS_RADIUS_M = 20_000;
/** Accès à la gare : temps fixe (min) et vitesse moyenne (km/h). */
export const ACCESS_FIXED_MIN = 5;
export const ACCESS_SPEED_KMH = 25;
/**
 * Coefficient du modèle gravitaire (déplacements·km² par jour et par
 * habitant²), calé pour qu'une LGV Paris – Lyon transporte de l'ordre de
 * 25 000 voyageurs par jour entre les deux villes.
 */
export const GRAVITY_K = 3.5e-4;
/** En dessous, la distance n'entre plus dans la décroissance (km). */
export const GRAVITY_MIN_DISTANCE_KM = 10;
/** Valeur du temps (€/h) : convertit les prix en minutes. */
export const VALUE_OF_TIME_EUR_H = 25;
/** Pénalité d'une correspondance (min), en plus de l'attente. */
export const TRANSFER_PENALTY_MIN = 10;
/** L'attente vaut la moitié de l'intervalle, plafonnée (min). */
export const MAX_WAIT_MIN = 30;
/** Voiture : détour routier, vitesses et coût kilométrique. */
export const ROAD_DETOUR = 1.3;
export const CAR_COST_PER_KM = 0.2;
export const CAR_PARKING_MIN = 10;
/** Occupants moyens d'une voiture sur un trajet interurbain : ils partagent les frais. */
export const CAR_OCCUPANCY = 1.6;
/**
 * Constante modale du train (min) : contrainte d'horaire et rupture de
 * charge, que la voiture n'impose pas.
 */
export const RAIL_CONSTANT_MIN = 30;
/** Sensibilité du logit, relative au coût généralisé de la voiture. */
export const LOGIT_SCALE = 4;

export interface Catchment {
  population: number;
  /** Temps d'accès moyen pondéré par la population (min). */
  accessMin: number;
}

/** Population et temps d'accès de chaque gare desservie. */
export function catchments(
  zones: readonly Zone[],
  stations: readonly DemandStation[],
  radiusM = ACCESS_RADIUS_M,
): Map<string, Catchment> {
  const sums = new Map<string, { population: number; weightedMin: number }>();
  for (const s of stations) sums.set(s.id, { population: 0, weightedMin: 0 });
  // Préfiltre en degrés : un rayon de 20 km fait au plus 0,3° en longitude
  // à la latitude de la France.
  const dLat = radiusM / 111_320;
  for (const zone of zones) {
    if (zone.population <= 0) continue;
    let best: DemandStation | null = null;
    let bestDistance = radiusM;
    const dLng = dLat / Math.cos((zone.position[1] * Math.PI) / 180);
    for (const s of stations) {
      if (Math.abs(s.position[1] - zone.position[1]) > dLat) continue;
      if (Math.abs(s.position[0] - zone.position[0]) > dLng) continue;
      const d = haversineDistance(zone.position, s.position);
      if (d <= bestDistance) {
        best = s;
        bestDistance = d;
      }
    }
    if (!best) continue;
    const sum = sums.get(best.id) as { population: number; weightedMin: number };
    const minutes = ACCESS_FIXED_MIN + (bestDistance / 1000 / ACCESS_SPEED_KMH) * 60;
    sum.population += zone.population;
    sum.weightedMin += zone.population * minutes;
  }
  const result = new Map<string, Catchment>();
  for (const [id, sum] of sums) {
    result.set(id, {
      population: sum.population,
      accessMin: sum.population > 0 ? sum.weightedMin / sum.population : ACCESS_FIXED_MIN,
    });
  }
  return result;
}

/** Trajet sur une ligne entre deux de ses arrêts. */
interface Ride {
  line: number;
  from: number;
  to: number;
  /** Arrêt de destination. */
  target: string;
  minutes: number;
  fareEur: number;
}

interface Paths {
  /** Coût généralisé (min) vers chaque gare atteinte. */
  cost: Map<string, number>;
  /** Dernier trajet emprunté pour atteindre chaque gare. */
  prev: Map<string, { station: string; ride: Ride }>;
}

/**
 * Coûts généralisés (min) depuis une gare vers toutes les autres, en
 * enchaînant des trajets sur les lignes. Chaque montée coûte l'attente et
 * une correspondance ; la première montée n'en paie pas.
 */
function shortestRides(origin: string, ridesFrom: Map<string, Ride[]>): Paths {
  const cost = new Map<string, number>([[origin, 0]]);
  const prev = new Map<string, { station: string; ride: Ride }>();
  const queue = new Set<string>([origin]);
  const done = new Set<string>();
  while (queue.size > 0) {
    let current: string | null = null;
    for (const id of queue) {
      if (current === null || (cost.get(id) ?? Infinity) < (cost.get(current) ?? Infinity)) {
        current = id;
      }
    }
    if (current === null) break;
    queue.delete(current);
    done.add(current);
    const base = cost.get(current) ?? Infinity;
    for (const ride of ridesFrom.get(current) ?? []) {
      if (done.has(ride.target)) continue;
      const candidate = base + ride.minutes + TRANSFER_PENALTY_MIN;
      if (candidate < (cost.get(ride.target) ?? Infinity)) {
        cost.set(ride.target, candidate);
        prev.set(ride.target, { station: current, ride });
        queue.add(ride.target);
      }
    }
  }
  for (const [id, value] of cost) if (id !== origin) cost.set(id, value - TRANSFER_PENALTY_MIN);
  return { cost, prev };
}

export interface LineLoad {
  /** Voyageurs transportés par jour (deux sens). */
  tripsPerDay: number;
  passengerKmPerDay: number;
  /** Recettes annuelles (M€). */
  revenueM: number;
  /** Charge maximale sur un intervalle, par jour et par sens, rapportée à l'offre. */
  peakLoadFactor: number;
}

export interface DemandResult {
  /** Déplacements quotidiens en train, tous les couples de gares. */
  railTripsPerDay: number;
  /** Marché tous modes entre gares desservies. */
  marketTripsPerDay: number;
  lines: Record<string, LineLoad>;
  /** Montées par jour à chaque gare. */
  boardings: Record<string, number>;
  catchments: Record<string, Catchment>;
  /** Principales relations (deux sens réunis), par trafic décroissant. */
  topPairs: { from: string; to: string; tripsPerDay: number; railShare: number }[];
}

const DAYS_PER_YEAR = 365;
/** Relations conservées dans le résultat. */
const TOP_PAIRS = 20;

/** Part du train entre deux coûts généralisés (min). */
export function railShare(railMin: number, carMin: number): number {
  if (!Number.isFinite(railMin)) return 0;
  return 1 / (1 + Math.exp((LOGIT_SCALE * (railMin - carMin)) / Math.max(carMin, 1)));
}

/** Coût généralisé de la voiture entre deux points (min). */
export function carCost(distanceM: number): number {
  const km = (distanceM / 1000) * ROAD_DETOUR;
  // Vitesse moyenne de porte à porte : routes en courte distance, autoroute au-delà.
  const speed = km < 50 ? 55 : km < 150 ? 80 : 100;
  const minutes = (km / speed) * 60 + CAR_PARKING_MIN;
  return minutes + (km * (CAR_COST_PER_KM / CAR_OCCUPANCY) * 60) / VALUE_OF_TIME_EUR_H;
}

export function computeDemand(
  zones: readonly Zone[],
  stations: readonly DemandStation[],
  lines: readonly DemandLine[],
): DemandResult {
  const served = new Set(lines.flatMap((l) => l.stops));
  const servedStations = stations.filter((s) => served.has(s.id));
  const area = catchments(zones, servedStations);
  const position = new Map(servedStations.map((s) => [s.id, s.position]));

  // Trajets possibles : sur chaque ligne, de tout arrêt vers tout arrêt
  // suivant, dans les deux sens.
  const ridesFrom = new Map<string, Ride[]>();
  lines.forEach((line, index) => {
    const wait = Math.min(line.headwayMin / 2, MAX_WAIT_MIN);
    const add = (a: number, b: number): void => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      let seconds = 0;
      let meters = 0;
      for (let k = lo; k < hi; k++) {
        seconds += line.legTimesS[k] ?? 0;
        meters += line.legLengthsM[k] ?? 0;
      }
      const from = line.stops[a] as string;
      const fareEur = (meters / 1000) * line.farePerKm;
      const ride: Ride = {
        line: index,
        from: a,
        to: b,
        target: line.stops[b] as string,
        minutes: wait + seconds / 60 + (fareEur * 60) / VALUE_OF_TIME_EUR_H,
        fareEur,
      };
      const list = ridesFrom.get(from) ?? [];
      list.push(ride);
      ridesFrom.set(from, list);
    };
    for (let a = 0; a < line.stops.length; a++) {
      for (let b = 0; b < line.stops.length; b++) if (a !== b) add(a, b);
    }
  });

  const loads = lines.map((line) => ({
    trips: 0,
    pkm: 0,
    revenue: 0,
    // Charge par intervalle et par sens (0 : sens des arrêts, 1 : retour).
    legs: [line.legLengthsM.map(() => 0), line.legLengthsM.map(() => 0)],
  }));
  const boardings: Record<string, number> = {};
  const pairs = new Map<string, { tripsPerDay: number; railShare: number }>();
  let railTrips = 0;
  let market = 0;
  const ids = servedStations.map((s) => s.id);

  for (let i = 0; i < ids.length; i++) {
    const origin = ids[i] as string;
    const ci = area.get(origin) as Catchment;
    if (ci.population <= 0) continue;
    const paths = shortestRides(origin, ridesFrom);
    for (let j = 0; j < ids.length; j++) {
      if (i === j) continue;
      const destination = ids[j] as string;
      const cj = area.get(destination) as Catchment;
      if (cj.population <= 0) continue;
      const crow = haversineDistance(
        position.get(origin) as LngLat,
        position.get(destination) as LngLat,
      );
      const km = Math.max(crow / 1000, GRAVITY_MIN_DISTANCE_KM);
      // Déplacements d'origine i vers j (un sens) : la moitié du marché du couple.
      const trips = (GRAVITY_K * ci.population * cj.population) / (km * km) / 2;
      market += trips;
      const pathCost = paths.cost.get(destination);
      const railMin =
        pathCost === undefined
          ? Infinity
          : ci.accessMin + pathCost + cj.accessMin + RAIL_CONSTANT_MIN;
      const share = railShare(railMin, carCost(crow));
      const rail = trips * share;
      if (rail <= 0) continue;
      railTrips += rail;
      const key = origin < destination ? `${origin}|${destination}` : `${destination}|${origin}`;
      const pair = pairs.get(key) ?? { tripsPerDay: 0, railShare: share };
      pair.tripsPerDay += rail;
      pairs.set(key, pair);
      // Affectation : remonte le chemin et charge chaque trajet.
      for (let at = destination; at !== origin;) {
        const back = paths.prev.get(at);
        if (!back) break;
        const { ride } = back;
        const line = lines[ride.line] as DemandLine;
        const load = loads[ride.line] as (typeof loads)[number];
        const direction = ride.to > ride.from ? 0 : 1;
        const lo = Math.min(ride.from, ride.to);
        const hi = Math.max(ride.from, ride.to);
        let meters = 0;
        for (let k = lo; k < hi; k++) {
          (load.legs[direction] as number[])[k] =
            ((load.legs[direction] as number[])[k] ?? 0) + rail;
          meters += line.legLengthsM[k] ?? 0;
        }
        load.trips += rail;
        load.pkm += (rail * meters) / 1000;
        load.revenue += rail * ride.fareEur;
        boardings[back.station] = (boardings[back.station] ?? 0) + rail;
        at = back.station;
      }
    }
  }

  const topPairs = [...pairs]
    .map(([key, pair]) => {
      const [from, to] = key.split('|') as [string, string];
      return { from, to, ...pair };
    })
    .sort((a, b) => b.tripsPerDay - a.tripsPerDay)
    .slice(0, TOP_PAIRS);
  const result: DemandResult = {
    railTripsPerDay: railTrips,
    marketTripsPerDay: market,
    lines: {},
    boardings,
    catchments: Object.fromEntries(area),
    topPairs,
  };
  lines.forEach((line, index) => {
    const load = loads[index] as (typeof loads)[number];
    const peak = Math.max(0, ...load.legs.flat());
    result.lines[line.id] = {
      tripsPerDay: load.trips,
      passengerKmPerDay: load.pkm,
      revenueM: (load.revenue * DAYS_PER_YEAR) / 1e6,
      peakLoadFactor: line.dailyCapacity > 0 ? peak / line.dailyCapacity : 0,
    };
  });
  return result;
}
