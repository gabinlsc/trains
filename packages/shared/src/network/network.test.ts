import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_SPEC } from '../infrastructure.ts';
import { copySelection, pasteFragment } from './clipboard.ts';
import { History } from './history.ts';
import { EMPTY_NETWORK, NetworkSchema, type Network, type Position } from './model.ts';
import {
  addNode,
  addSegment,
  mergeAtNode,
  moveNode,
  NetworkError,
  randomId,
  removeNode,
  removeSegment,
  segmentPath,
  segmentsAt,
  splitSegment,
  updateNode,
  updateSegment,
  type IdFactory,
} from './ops.ts';

/** Valeur présente, ou échec explicite du test. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('valeur attendue');
  return value;
}

/** Identifiants déterministes : n_000001, s_000002… */
function sequence(): IdFactory {
  let i = 0;
  return (prefix) => `${prefix}_${String(++i).padStart(6, '0')}`;
}

const PARIS: Position = [2.3553, 48.8805];
const LILLE: Position = [3.0571, 50.6364];
const ARRAS: Position = [2.7811, 50.2869];

/** Paris — Arras — Lille, en deux tronçons, Arras simple point de passage. */
function line(): { network: Network; ids: IdFactory } {
  const ids = sequence();
  let network = EMPTY_NETWORK;
  network = addNode(network, PARIS, {
    ids,
    station: { type: 'tgv', platforms: 8, terminus: true },
  }).network;
  network = addNode(network, ARRAS, { ids }).network;
  network = addNode(network, LILLE, {
    ids,
    station: { type: 'gare', platforms: 6, terminus: false },
  }).network;
  network = addSegment(network, 'n_000001', 'n_000002', { ids, via: [[2.6, 49.5]] }).network;
  network = addSegment(network, 'n_000002', 'n_000003', { ids }).network;
  return { network, ids };
}

describe('modèle', () => {
  it('valide un réseau cohérent et rejette les incohérences', () => {
    const { network } = line();
    expect(NetworkSchema.safeParse(network).success).toBe(true);
    const orphan = {
      ...network,
      segments: {
        ...network.segments,
        s_000004: { ...must(network.segments.s_000004), to: 'n_999999' },
      },
    };
    expect(NetworkSchema.safeParse(orphan).success).toBe(false);
    const station = {
      ...network,
      nodes: { ...network.nodes, n_000002: { ...must(network.nodes.n_000002), kind: 'station' } },
    };
    expect(NetworkSchema.safeParse(station).success).toBe(false);
  });

  it('génère des identifiants préfixés valides', () => {
    expect(randomId('n')).toMatch(/^n_[0-9a-z]{8}$/);
    expect(randomId('s')).not.toBe(randomId('s'));
  });
});

describe('opérations', () => {
  it('ne modifie jamais le réseau reçu', () => {
    const { network } = line();
    const frozen = JSON.stringify(network);
    moveNode(network, 'n_000002', [2.8, 50.3]);
    removeNode(network, 'n_000002');
    expect(JSON.stringify(network)).toBe(frozen);
  });

  it('crée des tronçons aux caractéristiques par défaut et refuse les erreurs', () => {
    const { network } = line();
    expect(network.segments.s_000004?.spec).toEqual(DEFAULT_TRACK_SPEC);
    expect(() => addSegment(network, 'n_000001', 'n_000001')).toThrow(NetworkError);
    expect(() => addSegment(network, 'n_000001', 'n_inconnu')).toThrow(/inexistant/);
    expect(() => addNode(network, PARIS, { id: 'n_000001' })).toThrow(/déjà présent/);
  });

  it('déduit les bifurcations et les points de passage', () => {
    const { network, ids } = line();
    const amiens = addNode(network, [2.2958, 49.8902], { ids });
    const branched = addSegment(amiens.network, 'n_000002', amiens.node.id, { ids }).network;
    expect(branched.nodes.n_000002?.kind).toBe('junction');
    expect(
      removeSegment(branched, must(Object.keys(branched.segments).at(-1))).nodes.n_000002?.kind,
    ).toBe('waypoint');
  });

  it('supprime un nœud et ses tronçons en cascade', () => {
    const { network } = line();
    const next = removeNode(network, 'n_000002');
    expect(Object.keys(next.nodes)).toEqual(['n_000001', 'n_000003']);
    expect(next.segments).toEqual({});
    expect(() => removeNode(next, 'n_000002')).toThrow(NetworkError);
  });

  it('met à jour gares et tronçons', () => {
    const { network } = line();
    const station = updateNode(network, 'n_000002', {
      station: { type: 'halte', platforms: 2, terminus: false },
      name: 'Arras',
    });
    expect(station.nodes.n_000002).toMatchObject({ kind: 'station', name: 'Arras' });
    expect(updateNode(station, 'n_000002', { station: undefined }).nodes.n_000002?.kind).toBe(
      'waypoint',
    );
    const fast = updateSegment(network, 's_000004', {
      spec: { ...DEFAULT_TRACK_SPEC, designSpeedKmh: 320 },
    });
    expect(fast.segments.s_000004?.spec.designSpeedKmh).toBe(320);
    expect(() => updateSegment(network, 's_inconnu', {})).toThrow(/inexistant/);
  });

  it('donne le tracé complet d’un tronçon et ses voisins', () => {
    const { network } = line();
    expect(segmentPath(network, must(network.segments.s_000004))).toEqual([
      PARIS,
      [2.6, 49.5],
      ARRAS,
    ]);
    expect(segmentsAt(network, 'n_000002').map((s) => s.id)).toEqual(['s_000004', 's_000005']);
  });

  it('scinde un tronçon à un point intermédiaire', () => {
    const { network, ids } = line();
    const result = splitSegment(network, 's_000004', 0, ids);
    expect(result.node.position).toEqual([2.6, 49.5]);
    expect(result.segments.map((s) => [s.from, s.to])).toEqual([
      ['n_000001', result.node.id],
      [result.node.id, 'n_000002'],
    ]);
    expect(result.network.segments.s_000004).toBeUndefined();
    expect(() => splitSegment(network, 's_000005', 0, ids)).toThrow(/point 0 absent/);
  });

  it('fusionne les tronçons d’un point de passage, quel que soit leur sens', () => {
    const { network, ids } = line();
    const reversed = removeSegment(network, 's_000005');
    const back = addSegment(reversed, 'n_000003', 'n_000002', { ids, via: [[2.9, 50.5]] }).network;
    const merged = mergeAtNode(back, 'n_000002', ids);
    expect(merged.segment.from).toBe('n_000001');
    expect(merged.segment.to).toBe('n_000003');
    expect(merged.segment.via).toEqual([[2.6, 49.5], ARRAS, [2.9, 50.5]]);
    expect(merged.network.nodes.n_000002).toBeUndefined();
  });

  it('refuse les fusions incohérentes', () => {
    const { network, ids } = line();
    expect(() => mergeAtNode(network, 'n_000001', ids)).toThrow(/gare/);
    const different = updateSegment(network, 's_000005', {
      spec: { ...DEFAULT_TRACK_SPEC, tracks: 1 },
    });
    expect(() => mergeAtNode(different, 'n_000002', ids)).toThrow(/caractéristiques/);
    const lone = removeSegment(network, 's_000005');
    expect(() => mergeAtNode(lone, 'n_000002', ids)).toThrow(/exactement deux/);
  });
});

describe('historique', () => {
  it('annule et rétablit sans limite', () => {
    const { network } = line();
    const history = new History(network);
    for (let i = 0; i < 500; i++) {
      history.execute({
        label: `déplacement ${i}`,
        apply: (n) => moveNode(n, 'n_000002', [2.78 + i * 1e-4, 50.28]),
      });
    }
    expect(history.size).toBe(500);
    while (history.canUndo) history.undo();
    expect(history.state).toBe(network);
    history.redo();
    expect(history.state.nodes.n_000002?.position).toEqual([2.78, 50.28]);
    expect(history.undoLabel).toBe('déplacement 0');
    expect(history.redoLabel).toBe('déplacement 1');
  });

  it('fusionne une série de déplacements en une seule étape', () => {
    const history = new History(line().network);
    for (let i = 0; i < 20; i++) {
      history.execute({
        label: 'Déplacer',
        mergeKey: 'drag:n_000002',
        apply: (n) => moveNode(n, 'n_000002', [2.7 + i * 0.01, 50.3]),
      });
    }
    expect(history.size).toBe(1);
    history.seal();
    history.execute({
      label: 'Déplacer',
      mergeKey: 'drag:n_000002',
      apply: (n) => moveNode(n, 'n_000002', [3, 50]),
    });
    expect(history.size).toBe(2);
    history.undo();
    history.undo();
    expect(history.state.nodes.n_000002?.position).toEqual(ARRAS);
  });

  it('oublie le futur après une nouvelle commande et ignore les commandes sans effet', () => {
    const history = new History(line().network);
    history.execute({ label: 'Supprimer', apply: (n) => removeSegment(n, 's_000005') });
    history.undo();
    history.execute({ label: 'Rien', apply: (n) => n });
    expect(history.canRedo).toBe(true);
    history.execute({ label: 'Déplacer', apply: (n) => moveNode(n, 'n_000001', [2.36, 48.88]) });
    expect(history.canRedo).toBe(false);
    history.reset(EMPTY_NETWORK);
    expect(history.canUndo).toBe(false);
    expect(history.undo()).toBe(EMPTY_NETWORK);
    expect(history.redo()).toBe(EMPTY_NETWORK);
  });
});

describe('copier-coller', () => {
  it('copie un tronçon avec ses extrémités et le colle décalé sous de nouveaux identifiants', () => {
    const { network, ids } = line();
    const linked = updateNode(network, 'n_000003', {
      station: { type: 'gare', platforms: 6, terminus: false, existingUic: '87286005' },
    });
    const fragment = copySelection(linked, [], ['s_000005']);
    expect(fragment.nodes.map((n) => n.id).sort()).toEqual(['n_000002', 'n_000003']);
    const pasted = pasteFragment(linked, fragment, [0.1, -0.1], ids);
    expect(pasted.nodeIds).toHaveLength(2);
    expect(pasted.segmentIds).toHaveLength(1);
    const copy = must(pasted.network.segments[must(pasted.segmentIds[0])]);
    expect(pasted.network.nodes[copy.to]?.position[0]).toBeCloseTo(LILLE[0] + 0.1, 9);
    expect(pasted.network.nodes[copy.to]?.station?.existingUic).toBeUndefined();
    expect(NetworkSchema.safeParse(pasted.network).success).toBe(true);
    expect(Object.keys(pasted.network.segments)).toHaveLength(3);
  });

  it('ignore les identifiants inconnus', () => {
    const { network } = line();
    expect(copySelection(network, ['n_inconnu'], ['s_inconnu'])).toEqual({
      nodes: [],
      segments: [],
    });
    const partial = pasteFragment(
      network,
      { nodes: [], segments: [must(network.segments.s_000004)] },
      [0, 0],
    );
    expect(partial.segmentIds).toEqual([]);
  });
});
