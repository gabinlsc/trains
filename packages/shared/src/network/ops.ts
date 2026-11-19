import { DEFAULT_TRACK_SPEC, type TrackSpec } from '../infrastructure.ts';
import type { Id, Line, Network, NetworkNode, Position, Segment, Station } from './model.ts';

/**
 * Opérations d'édition du réseau. Toutes sont pures : elles renvoient un
 * nouveau réseau et ne modifient jamais celui reçu, ce qui rend l'annulation
 * triviale (on garde l'état précédent) et partage la structure inchangée.
 */

export type IdFactory = (prefix: 'n' | 's' | 'l') => Id;

/** Identifiants aléatoires en base 36 : sans collision en pratique, courts dans les sauvegardes. */
export const randomId: IdFactory = (prefix) => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const body = [...bytes].map((b) => (b % 36).toString(36)).join('');
  return `${prefix}_${body}`;
};

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Copie d'un dictionnaire sans une clé (les opérations restent immuables). */
function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function requireNode(network: Network, id: Id): NetworkNode {
  const node = network.nodes[id];
  if (!node) throw new NetworkError(`nœud ${id} inexistant`);
  return node;
}

function requireSegment(network: Network, id: Id): Segment {
  const segment = network.segments[id];
  if (!segment) throw new NetworkError(`tronçon ${id} inexistant`);
  return segment;
}

/** Tronçons reliés à un nœud. */
export function segmentsAt(network: Network, nodeId: Id): Segment[] {
  return Object.values(network.segments).filter((s) => s.from === nodeId || s.to === nodeId);
}

/**
 * Nature déduite d'un nœud sans gare : bifurcation dès trois tronçons,
 * simple point de passage sinon. Une gare reste une gare.
 */
function withDerivedKind(network: Network, nodeId: Id): Network {
  const node = network.nodes[nodeId];
  if (!node || node.kind === 'station') return network;
  const kind = segmentsAt(network, nodeId).length >= 3 ? 'junction' : 'waypoint';
  if (kind === node.kind) return network;
  return { ...network, nodes: { ...network.nodes, [nodeId]: { ...node, kind } } };
}

export function addNode(
  network: Network,
  position: Position,
  options: { id?: Id; ids?: IdFactory; station?: Station; name?: string } = {},
): { network: Network; node: NetworkNode } {
  const id = options.id ?? (options.ids ?? randomId)('n');
  if (network.nodes[id]) throw new NetworkError(`nœud ${id} déjà présent`);
  const node: NetworkNode = {
    id,
    kind: options.station ? 'station' : 'waypoint',
    position,
    ...(options.station ? { station: options.station } : {}),
    ...(options.name ? { name: options.name } : {}),
  };
  return { network: { ...network, nodes: { ...network.nodes, [id]: node } }, node };
}

export function moveNode(network: Network, id: Id, position: Position): Network {
  const node = requireNode(network, id);
  return { ...network, nodes: { ...network.nodes, [id]: { ...node, position } } };
}

/** Une gare qui cesse de l'être n'est plus desservie. */
function dropUnservedStops(network: Network, nodeId: Id): Network {
  if (network.nodes[nodeId]?.kind === 'station') return network;
  const lines = withoutStop(network.lines, nodeId);
  return lines === network.lines ? network : { ...network, lines };
}

export function updateNode(
  network: Network,
  id: Id,
  patch: Partial<Pick<NetworkNode, 'name' | 'station' | 'flyover'>>,
): Network {
  const node = requireNode(network, id);
  const next: NetworkNode = { ...node, ...patch };
  if (patch.station) next.kind = 'station';
  if ('station' in patch && !patch.station) {
    delete next.station;
    next.kind = 'waypoint';
  }
  return dropUnservedStops(
    withDerivedKind({ ...network, nodes: { ...network.nodes, [id]: next } }, id),
    id,
  );
}

/** Supprime un nœud et, en cascade, les tronçons qui le touchent. */
export function removeNode(network: Network, id: Id): Network {
  requireNode(network, id);
  const nodes = omit(network.nodes, id);
  const segments: Network['segments'] = {};
  const touched = new Set<Id>();
  for (const [key, segment] of Object.entries(network.segments)) {
    if (segment.from === id || segment.to === id) {
      touched.add(segment.from === id ? segment.to : segment.from);
    } else {
      segments[key] = segment;
    }
  }
  let next: Network = { ...network, nodes, segments, lines: withoutStop(network.lines, id) };
  for (const other of touched) next = withDerivedKind(next, other);
  return next;
}

/** Retire un arrêt des lignes qui le desservent ; une ligne réduite à un arrêt disparaît. */
function withoutStop(lines: Network['lines'], nodeId: Id): Network['lines'] {
  let changed = false;
  const next: Network['lines'] = {};
  for (const [key, line] of Object.entries(lines)) {
    if (!line.stops.includes(nodeId)) {
      next[key] = line;
      continue;
    }
    changed = true;
    // Deux arrêts identiques consécutifs fusionnent (aller-retour sur la gare retirée).
    const stops = line.stops
      .filter((stop) => stop !== nodeId)
      .filter((stop, i, all) => stop !== all[i - 1]);
    if (stops.length >= 2) next[key] = { ...line, stops };
  }
  return changed ? next : lines;
}

export function addSegment(
  network: Network,
  from: Id,
  to: Id,
  options: { id?: Id; ids?: IdFactory; via?: Position[]; spec?: TrackSpec } = {},
): { network: Network; segment: Segment } {
  requireNode(network, from);
  requireNode(network, to);
  if (from === to) throw new NetworkError('un tronçon relie deux nœuds distincts');
  const id = options.id ?? (options.ids ?? randomId)('s');
  if (network.segments[id]) throw new NetworkError(`tronçon ${id} déjà présent`);
  const segment: Segment = {
    id,
    from,
    to,
    via: options.via ?? [],
    spec: options.spec ?? { ...DEFAULT_TRACK_SPEC },
    structures: [],
  };
  let next: Network = { ...network, segments: { ...network.segments, [id]: segment } };
  next = withDerivedKind(withDerivedKind(next, from), to);
  return { network: next, segment };
}

export function removeSegment(network: Network, id: Id): Network {
  const segment = requireSegment(network, id);
  const segments = omit(network.segments, id);
  const next = withDerivedKind(withDerivedKind({ ...network, segments }, segment.from), segment.to);
  return next;
}

export function updateSegment(
  network: Network,
  id: Id,
  patch: Partial<Pick<Segment, 'spec' | 'via' | 'structures'>>,
): Network {
  const segment = requireSegment(network, id);
  return { ...network, segments: { ...network.segments, [id]: { ...segment, ...patch } } };
}

/** Polyligne complète d'un tronçon, extrémités comprises. */
export function segmentPath(network: Network, segment: Segment): Position[] {
  return [
    requireNode(network, segment.from).position,
    ...segment.via,
    requireNode(network, segment.to).position,
  ];
}

/**
 * Scinde un tronçon au point intermédiaire `viaIndex` : ce point devient un
 * nœud, et deux tronçons aux mêmes caractéristiques le relient aux extrémités.
 * Les ouvrages d'art sont recalculés ensuite par le moteur.
 */
export function splitSegment(
  network: Network,
  id: Id,
  viaIndex: number,
  ids: IdFactory = randomId,
): { network: Network; node: NetworkNode; segments: [Segment, Segment] } {
  const segment = requireSegment(network, id);
  const position = segment.via[viaIndex];
  if (!position) throw new NetworkError(`point ${viaIndex} absent du tronçon ${id}`);
  let next = removeSegment(network, id);
  const added = addNode(next, position, { ids });
  next = added.network;
  const first = addSegment(next, segment.from, added.node.id, {
    ids,
    via: segment.via.slice(0, viaIndex),
    spec: segment.spec,
  });
  const second = addSegment(first.network, added.node.id, segment.to, {
    ids,
    via: segment.via.slice(viaIndex + 1),
    spec: segment.spec,
  });
  return {
    network: second.network,
    node: second.network.nodes[added.node.id] as NetworkNode,
    segments: [first.segment, second.segment],
  };
}

/**
 * Fusionne les deux tronçons d'un point de passage en un seul. Refusé pour
 * une gare, une bifurcation, ou des tronçons aux caractéristiques différentes.
 */
export function mergeAtNode(
  network: Network,
  nodeId: Id,
  ids: IdFactory = randomId,
): { network: Network; segment: Segment } {
  const node = requireNode(network, nodeId);
  if (node.kind === 'station') throw new NetworkError('impossible de fusionner à une gare');
  const around = segmentsAt(network, nodeId);
  if (around.length !== 2) throw new NetworkError('la fusion exige exactement deux tronçons');
  const [a, b] = around as [Segment, Segment];
  if (JSON.stringify(a.spec) !== JSON.stringify(b.spec)) {
    throw new NetworkError('tronçons aux caractéristiques différentes');
  }
  // Oriente les deux tronçons pour qu'ils se suivent : a → nœud → b.
  const aPath = a.to === nodeId ? a.via : [...a.via].reverse();
  const aStart = a.to === nodeId ? a.from : a.to;
  const bPath = b.from === nodeId ? b.via : [...b.via].reverse();
  const bEnd = b.from === nodeId ? b.to : b.from;
  if (aStart === bEnd) throw new NetworkError('la fusion créerait une boucle');
  let next = removeSegment(removeSegment(network, a.id), b.id);
  next = { ...next, nodes: omit(next.nodes, nodeId) };
  return addSegment(next, aStart, bEnd, {
    ids,
    via: [...aPath, node.position, ...bPath],
    spec: a.spec,
  });
}

/** Point d'un tracé le plus proche d'une position, avec sa place dans la polyligne. */
export interface PathProjection {
  /** Index du premier sommet de la partie de tracé concernée. */
  index: number;
  /** Position relative sur cette partie, de 0 à 1. */
  t: number;
  point: Position;
  /** Distance approchée à la position (m). */
  distance: number;
}

const M_PER_DEG = 111_320;

/**
 * Projection orthogonale sur une polyligne, dans un repère plan local
 * (longitudes corrigées de la latitude) : largement assez précis à l'échelle
 * d'un clic sur la carte.
 */
export function projectOnPath(path: readonly Position[], position: Position): PathProjection {
  const k = Math.cos((position[1] * Math.PI) / 180);
  let best: PathProjection = {
    index: 0,
    t: 0,
    point: path[0] ?? position,
    distance: Infinity,
  };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i] as Position;
    const b = path[i + 1] as Position;
    const dx = (b[0] - a[0]) * k;
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const px = (position[0] - a[0]) * k;
    const py = position[1] - a[1];
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
    const distance = Math.hypot(px - t * dx, py - t * dy) * M_PER_DEG;
    if (distance < best.distance) {
      best = {
        index: i,
        t,
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        distance,
      };
    }
  }
  return best;
}

/**
 * Pose un nœud sur un tronçon existant, au point le plus proche de
 * `position` : le tronçon est scindé en deux et le nœud pourra recevoir un
 * troisième tronçon (bifurcation, raccordement). Tout près d'une extrémité
 * (moins de `toleranceM`), c'est le nœud existant qui est renvoyé.
 */
export function insertNodeOnSegment(
  network: Network,
  segmentId: Id,
  position: Position,
  ids: IdFactory = randomId,
  toleranceM = 5,
): { network: Network; node: NetworkNode } {
  const segment = requireSegment(network, segmentId);
  const path = segmentPath(network, segment);
  const projection = projectOnPath(path, position);
  const from = requireNode(network, segment.from);
  const to = requireNode(network, segment.to);
  const near = (p: Position): boolean =>
    projectOnPath([p, p], projection.point).distance < toleranceM;
  if (near(from.position)) return { network, node: from };
  if (near(to.position)) return { network, node: to };
  // Un sommet intermédiaire déjà présent sert de point de coupure ; sinon on
  // insère le point projeté dans le tracé avant de scinder.
  const viaIndex = segment.via.findIndex((p) => near(p));
  if (viaIndex >= 0) {
    const split = splitSegment(network, segmentId, viaIndex, ids);
    return { network: split.network, node: split.node };
  }
  // Le sommet path[index] est via[index - 1] : le point s'insère après lui.
  const via = [...segment.via];
  via.splice(projection.index, 0, projection.point);
  const withPoint = updateSegment(network, segmentId, { via });
  const split = splitSegment(withPoint, segmentId, projection.index, ids);
  return { network: split.network, node: split.node };
}

// --- Lignes commerciales -------------------------------------------------------

export type LineInput = Omit<Line, 'id'>;

function checkStops(network: Network, stops: readonly Id[]): void {
  if (stops.length < 2) throw new NetworkError('une ligne dessert au moins deux gares');
  for (const stop of stops) {
    if (requireNode(network, stop).kind !== 'station') {
      throw new NetworkError('une ligne ne s’arrête qu’en gare');
    }
  }
  if (stops.some((stop, i) => stop === stops[i - 1])) {
    throw new NetworkError('deux arrêts consécutifs identiques');
  }
}

export function addLine(
  network: Network,
  input: LineInput,
  options: { id?: Id; ids?: IdFactory } = {},
): { network: Network; line: Line } {
  checkStops(network, input.stops);
  const id = options.id ?? (options.ids ?? randomId)('l');
  if (network.lines[id]) throw new NetworkError(`ligne ${id} déjà présente`);
  const line: Line = { ...input, stops: [...input.stops], id };
  return { network: { ...network, lines: { ...network.lines, [id]: line } }, line };
}

export function updateLine(network: Network, id: Id, patch: Partial<LineInput>): Network {
  const line = network.lines[id];
  if (!line) throw new NetworkError(`ligne ${id} inexistante`);
  if (patch.stops) checkStops(network, patch.stops);
  const next = { ...line, ...patch };
  if (next.lastDepartureMin < next.firstDepartureMin) {
    throw new NetworkError('le dernier départ précède le premier');
  }
  return { ...network, lines: { ...network.lines, [id]: next } };
}

export function removeLine(network: Network, id: Id): Network {
  if (!network.lines[id]) throw new NetworkError(`ligne ${id} inexistante`);
  return { ...network, lines: omit(network.lines, id) };
}

/** Départs par jour et par sens. */
export function departuresPerDay(
  line: Pick<Line, 'headwayMin' | 'firstDepartureMin' | 'lastDepartureMin'>,
): number {
  return Math.floor((line.lastDepartureMin - line.firstDepartureMin) / line.headwayMin) + 1;
}
