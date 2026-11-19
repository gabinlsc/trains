/**
 * Itinéraire des lignes commerciales : plus court chemin sur le réseau entre
 * deux arrêts consécutifs (algorithme de Dijkstra, longueurs en mètres).
 */
import { segmentPath, type Id, type Line, type Network, type Segment } from '@trains/shared';
import { polylineLength } from './geo.ts';

export interface RouteStep {
  segment: Id;
  /** Parcouru de `to` vers `from`. */
  reversed: boolean;
}

export interface RouteLeg {
  from: Id;
  to: Id;
  steps: RouteStep[];
  lengthM: number;
}

export interface LineRoute {
  /** Vrai si chaque arrêt est relié au suivant. */
  ok: boolean;
  legs: (RouteLeg | null)[];
  /** Index des intervalles sans chemin entre leurs deux arrêts. */
  unreachable: number[];
  lengthM: number;
}

export type SegmentLength = (segment: Segment) => number;

/** Longueur du tracé brut d'un tronçon (m). */
export function rawLength(network: Network): SegmentLength {
  return (segment) => polylineLength(segmentPath(network, segment));
}

/** Plus court chemin entre deux nœuds, ou null s'ils ne sont pas reliés. */
export function shortestPath(
  network: Network,
  from: Id,
  to: Id,
  length: SegmentLength = rawLength(network),
): RouteLeg | null {
  if (from === to) return { from, to, steps: [], lengthM: 0 };
  const adjacency = new Map<Id, { node: Id; step: RouteStep; cost: number }[]>();
  for (const segment of Object.values(network.segments)) {
    const cost = length(segment);
    const link = (a: Id, b: Id, reversed: boolean): void => {
      const list = adjacency.get(a) ?? [];
      list.push({ node: b, step: { segment: segment.id, reversed }, cost });
      adjacency.set(a, list);
    };
    link(segment.from, segment.to, false);
    link(segment.to, segment.from, true);
  }
  const dist = new Map<Id, number>([[from, 0]]);
  const prev = new Map<Id, { node: Id; step: RouteStep }>();
  const done = new Set<Id>();
  // File de priorité naïve : les réseaux d'un joueur comptent quelques
  // centaines de nœuds, un tas n'apporterait rien de mesurable.
  const queue = new Set<Id>([from]);
  while (queue.size > 0) {
    let current: Id | null = null;
    for (const id of queue) {
      if (current === null || (dist.get(id) ?? Infinity) < (dist.get(current) ?? Infinity)) {
        current = id;
      }
    }
    if (current === null) break;
    queue.delete(current);
    if (current === to) break;
    done.add(current);
    const base = dist.get(current) ?? Infinity;
    for (const edge of adjacency.get(current) ?? []) {
      if (done.has(edge.node)) continue;
      const candidate = base + edge.cost;
      if (candidate < (dist.get(edge.node) ?? Infinity)) {
        dist.set(edge.node, candidate);
        prev.set(edge.node, { node: current, step: edge.step });
        queue.add(edge.node);
      }
    }
  }
  const total = dist.get(to);
  if (total === undefined) return null;
  const steps: RouteStep[] = [];
  for (let node = to; node !== from;) {
    const back = prev.get(node);
    if (!back) return null;
    steps.unshift(back.step);
    node = back.node;
  }
  return { from, to, steps, lengthM: total };
}

/** Itinéraire complet d'une ligne, arrêt par arrêt. */
export function lineRoute(
  network: Network,
  line: Pick<Line, 'stops'>,
  length: SegmentLength = rawLength(network),
): LineRoute {
  const legs: (RouteLeg | null)[] = [];
  const unreachable: number[] = [];
  let lengthM = 0;
  for (let i = 1; i < line.stops.length; i++) {
    const leg = shortestPath(network, line.stops[i - 1] as Id, line.stops[i] as Id, length);
    legs.push(leg);
    if (leg) lengthM += leg.lengthM;
    else unreachable.push(i - 1);
  }
  return { ok: unreachable.length === 0, legs, unreachable, lengthM };
}

/** Tronçons parcourus par un itinéraire, dans l'ordre, sans doublon consécutif. */
export function routeSegments(route: LineRoute): RouteStep[] {
  return route.legs.flatMap((leg) => leg?.steps ?? []);
}
