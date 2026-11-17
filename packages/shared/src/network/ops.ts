import { DEFAULT_TRACK_SPEC, type TrackSpec } from '../infrastructure.ts';
import type { Id, Network, NetworkNode, Position, Segment, Station } from './model.ts';

/**
 * Opérations d'édition du réseau. Toutes sont pures : elles renvoient un
 * nouveau réseau et ne modifient jamais celui reçu, ce qui rend l'annulation
 * triviale (on garde l'état précédent) et partage la structure inchangée.
 */

export type IdFactory = (prefix: 'n' | 's') => Id;

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
  return withDerivedKind({ ...network, nodes: { ...network.nodes, [id]: next } }, id);
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
  let next: Network = { nodes, segments };
  for (const other of touched) next = withDerivedKind(next, other);
  return next;
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
