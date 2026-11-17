import type { Id, Network, NetworkNode, Position, Segment } from './model.ts';
import { randomId, type IdFactory } from './ops.ts';

/** Fragment de réseau copié : nœuds et tronçons, positions absolues. */
export interface Fragment {
  nodes: NetworkNode[];
  segments: Segment[];
}

/**
 * Copie une sélection. Les extrémités des tronçons sélectionnés sont copiées
 * avec eux, pour que le fragment collé soit toujours un graphe valide.
 */
export function copySelection(
  network: Network,
  nodeIds: Iterable<Id>,
  segmentIds: Iterable<Id>,
): Fragment {
  const segments = [...new Set(segmentIds)]
    .map((id) => network.segments[id])
    .filter((s): s is Segment => s !== undefined);
  const nodeSet = new Set<Id>(nodeIds);
  for (const s of segments) {
    nodeSet.add(s.from);
    nodeSet.add(s.to);
  }
  const nodes = [...nodeSet]
    .map((id) => network.nodes[id])
    .filter((n): n is NetworkNode => n !== undefined);
  return { nodes, segments };
}

const shift = ([lng, lat]: Position, [dx, dy]: Position): Position => [lng + dx, lat + dy];

/**
 * Colle un fragment avec un décalage (en degrés), sous de nouveaux
 * identifiants. Les gares collées perdent leur lien vers une gare réelle :
 * deux gares ne peuvent pas représenter le même bâtiment.
 */
export function pasteFragment(
  network: Network,
  fragment: Fragment,
  offset: Position,
  ids: IdFactory = randomId,
): { network: Network; nodeIds: Id[]; segmentIds: Id[] } {
  const mapping = new Map<Id, Id>();
  const nodes = { ...network.nodes };
  for (const node of fragment.nodes) {
    const id = ids('n');
    mapping.set(node.id, id);
    const copy: NetworkNode = { ...node, id, position: shift(node.position, offset) };
    if (copy.station?.existingUic) {
      const { existingUic: _uic, ...station } = copy.station;
      copy.station = station;
    }
    nodes[id] = copy;
  }
  const segments = { ...network.segments };
  const segmentIds: Id[] = [];
  for (const segment of fragment.segments) {
    const from = mapping.get(segment.from);
    const to = mapping.get(segment.to);
    if (!from || !to) continue;
    const id = ids('s');
    segmentIds.push(id);
    segments[id] = {
      ...segment,
      id,
      from,
      to,
      via: segment.via.map((p) => shift(p, offset)),
      structures: segment.structures.map((s) => ({ ...s })),
    };
  }
  return { network: { nodes, segments }, nodeIds: [...mapping.values()], segmentIds };
}
