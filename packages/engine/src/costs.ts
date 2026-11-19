/**
 * Modèle de coûts d'investissement et d'entretien de l'infrastructure.
 *
 * Montants en millions d'euros (M€) aux conditions économiques de 2026, hors
 * taxes. Les valeurs sont des ordres de grandeur tirés des coûts constatés
 * sur les projets français récents (LGV, modernisations de lignes, pôles
 * d'échanges) ; elles servent à arbitrer entre variantes d'un tracé, pas à
 * chiffrer un appel d'offres. Le détail et les sources sont dans
 * docs/MODELE-ECONOMIQUE.md : toute modification s'y reporte.
 */
import type { Electrification, Network, Signalling, Station, TrackSpec } from '@trains/shared';

/**
 * Voie et plateforme d'une double voie (M€/km), hors ouvrages d'art,
 * terrassements, électrification et signalisation, selon la vitesse de
 * conception (km/h). Interpolation linéaire entre les points.
 */
export const TRACK_COST_PER_KM: readonly (readonly [number, number])[] = [
  [100, 4],
  [160, 6],
  [220, 10],
  [320, 16],
];

/** Coût relatif selon le nombre de voies (double voie = 1). */
export const TRACKS_FACTOR: Readonly<Record<1 | 2 | 4, number>> = { 1: 0.6, 2: 1, 4: 1.9 };

/** La voie métrique, plus légère, coûte environ trois quarts de la voie normale. */
export const METRE_GAUGE_FACTOR = 0.75;

/** Électrification d'une double voie (M€/km), sous-stations comprises. */
export const ELECTRIFICATION_PER_KM: Readonly<Record<Electrification, number>> = {
  none: 0,
  ac25k: 1,
  // Le continu exige des sous-stations tous les 10 à 15 km, contre 50 en 25 kV.
  dc1500: 1.4,
};

/** Signalisation d'une double voie (M€/km). */
export const SIGNALLING_PER_KM: Readonly<Record<Signalling, number>> = {
  bapr: 0.25,
  bal: 0.6,
  ertms2: 0.9,
};

/** Ouvrages d'art pour une double voie (M€/km d'ouvrage). */
export const STRUCTURE_PER_KM = { tunnel: 45, viaduct: 25, bridge: 20 } as const;
export type CostedStructure = keyof typeof STRUCTURE_PER_KM;

/** Terrassements : M€ par km et par mètre d'écart moyen entre voie et terrain. */
export const EARTHWORK_PER_KM_PER_M = 0.12;

/** Gares : base et supplément par quai (M€). */
export const STATION_COST: Readonly<
  Record<Station['type'], { base: number; perPlatform: number }>
> = {
  halte: { base: 1.5, perPlatform: 0 },
  gare: { base: 6, perPlatform: 1.5 },
  correspondance: { base: 20, perPlatform: 3 },
  tgv: { base: 40, perPlatform: 5 },
};

/** Reprendre une gare existante revient à la moderniser : 40 % du neuf. */
export const EXISTING_STATION_FACTOR = 0.4;

/** Bifurcation à niveau, et supplément pour un saut-de-mouton (M€). */
export const JUNCTION_COST = 4;
export const FLYOVER_COST = 20;

/** Études, maîtrise d'œuvre et provisions pour aléas, en part des travaux. */
export const CONTINGENCY_RATE = 0.15;

/** Entretien annuel, en part de l'investissement de chaque poste. */
export const MAINTENANCE_RATE = {
  track: 0.012,
  earthworks: 0.004,
  structures: 0.005,
  electrification: 0.02,
  signalling: 0.03,
  stations: 0.015,
  junctions: 0.02,
} as const;

export type CostItem = keyof typeof MAINTENANCE_RATE;
export const COST_ITEMS = Object.keys(MAINTENANCE_RATE) as CostItem[];

/** Ventilation d'un coût par poste, avec provision et total (M€). */
export type CostBreakdown = Record<CostItem, number> & { contingency: number; total: number };

function emptyItems(): Record<CostItem, number> {
  return {
    track: 0,
    earthworks: 0,
    structures: 0,
    electrification: 0,
    signalling: 0,
    stations: 0,
    junctions: 0,
  };
}

function finish(items: Record<CostItem, number>): CostBreakdown {
  const works = COST_ITEMS.reduce((sum, key) => sum + items[key], 0);
  const contingency = works * CONTINGENCY_RATE;
  return { ...items, contingency, total: works + contingency };
}

/** Somme de plusieurs ventilations. */
export function addCosts(...costs: readonly CostBreakdown[]): CostBreakdown {
  const items = emptyItems();
  for (const cost of costs) for (const key of COST_ITEMS) items[key] += cost[key];
  return finish(items);
}

/** Coût de voie et plateforme (M€/km) d'une double voie à cette vitesse. */
export function trackCostPerKm(speedKmh: number): number {
  const table = TRACK_COST_PER_KM;
  const first = table[0] as readonly [number, number];
  const last = table[table.length - 1] as readonly [number, number];
  if (speedKmh <= first[0]) return first[1];
  // Au-delà du dernier point, la pente du dernier intervalle se prolonge.
  const prev = table[table.length - 2] as readonly [number, number];
  if (speedKmh >= last[0])
    return last[1] + ((speedKmh - last[0]) * (last[1] - prev[1])) / (last[0] - prev[0]);
  for (let i = 1; i < table.length; i++) {
    const [v1, c1] = table[i - 1] as readonly [number, number];
    const [v2, c2] = table[i] as readonly [number, number];
    if (speedKmh <= v2) return c1 + ((speedKmh - v1) / (v2 - v1)) * (c2 - c1);
  }
  return last[1];
}

export interface SegmentCostInput {
  lengthM: number;
  spec: TrackSpec;
  /** Ouvrages d'art, par longueur (m). */
  structures?: readonly { kind: CostedStructure; lengthM: number }[];
  /** Écart moyen voie/terrain hors ouvrages (m) ; 0 en terrain plat. */
  earthworkDepthM?: number;
}

/** Coût d'investissement d'un tronçon. */
export function segmentCost(input: SegmentCostInput): CostBreakdown {
  const km = input.lengthM / 1000;
  const { spec } = input;
  const width = TRACKS_FACTOR[spec.tracks];
  const gauge = spec.gauge === 'metre' ? METRE_GAUGE_FACTOR : 1;
  const items = emptyItems();
  const structureKm = (input.structures ?? []).reduce((sum, s) => sum + s.lengthM / 1000, 0);
  // La voie courante s'arrête aux ouvrages, dont le prix inclut la voie portée.
  const openKm = Math.max(0, km - structureKm);
  items.track = openKm * trackCostPerKm(spec.designSpeedKmh) * width * gauge;
  items.earthworks = openKm * EARTHWORK_PER_KM_PER_M * (input.earthworkDepthM ?? 0) * width;
  for (const s of input.structures ?? []) {
    items.structures += (s.lengthM / 1000) * STRUCTURE_PER_KM[s.kind] * width * gauge;
  }
  items.electrification = km * ELECTRIFICATION_PER_KM[spec.electrification] * width;
  items.signalling = km * SIGNALLING_PER_KM[spec.signalling] * width;
  return finish(items);
}

/** Coût d'une gare (M€). */
export function stationCost(station: Station): number {
  const { base, perPlatform } = STATION_COST[station.type];
  const cost = base + perPlatform * station.platforms;
  return station.existingUic ? cost * EXISTING_STATION_FACTOR : cost;
}

/** Coût d'une bifurcation (M€), dénivelée ou non. */
export function junctionCost(flyover = false): number {
  return JUNCTION_COST + (flyover ? FLYOVER_COST : 0);
}

/**
 * Coût d'un réseau. `segment` fournit, pour chaque tronçon, sa longueur et
 * ce que l'on sait de ses ouvrages et terrassements (profil calculé ou non).
 */
export function networkCost(
  network: Network,
  segment: (id: string) => Omit<SegmentCostInput, 'spec'>,
): CostBreakdown {
  const parts: CostBreakdown[] = [];
  for (const s of Object.values(network.segments)) {
    parts.push(segmentCost({ ...segment(s.id), spec: s.spec }));
  }
  const items = emptyItems();
  for (const node of Object.values(network.nodes)) {
    if (node.station) items.stations += stationCost(node.station);
    else if (node.kind === 'junction') items.junctions += junctionCost(node.flyover);
  }
  return addCosts(finish(items), ...parts);
}

/** Entretien annuel (M€/an) d'un investissement ventilé. */
export function maintenanceCost(cost: CostBreakdown): number {
  return COST_ITEMS.reduce((sum, key) => sum + cost[key] * MAINTENANCE_RATE[key], 0);
}

/**
 * Écart moyen voie/terrain (m) hors ouvrages, à partir d'un profil en long :
 * la hauteur moyenne des déblais et remblais qui entre dans le coût.
 */
export function earthworkDepth(
  terrain: readonly number[],
  track: readonly number[],
  structures: readonly { from: number; to: number }[] = [],
  distance: readonly number[] = [],
): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < terrain.length; i++) {
    const d = distance[i];
    if (d !== undefined && structures.some((s) => d >= s.from && d <= s.to)) continue;
    sum += Math.abs((track[i] as number) - (terrain[i] as number));
    count++;
  }
  return count === 0 ? 0 : sum / count;
}
