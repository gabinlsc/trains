import { addNode, addSegment, EMPTY_NETWORK, type Network, type Position } from '@trains/shared';
import { describe, expect, it } from 'vitest';
import { networkToGeoJSON, previewPath } from './geometry.ts';
import { findSnap, type SnapTarget } from './snap.ts';
import { DEFAULT_PLATFORMS, EditorStore } from './store.svelte.ts';

const A: Position = [2.2, 47.0];
const B: Position = [2.4, 47.0];
const C: Position = [2.4, 47.09];

function network(): Network {
  let n = EMPTY_NETWORK;
  n = addNode(n, A, { id: 'n_aaaaaa' }).network;
  n = addNode(n, C, { id: 'n_cccccc' }).network;
  return addSegment(n, 'n_aaaaaa', 'n_cccccc', { id: 's_ssssss', via: [B] }).network;
}

describe('rendu du réseau', () => {
  it('lisse les tracés au rayon de la vitesse de conception', () => {
    const geo = networkToGeoJSON(network());
    const line = geo.segments.features[0];
    expect(line?.properties).toMatchObject({ id: 's_ssssss', speed: 160, tracks: 2, issues: 0 });
    // Le sommet anguleux est remplacé par un arc.
    expect(line?.geometry.coordinates.length).toBeGreaterThan(10);
    expect(geo.nodes.features.map((f) => f.properties.id).sort()).toEqual(['n_aaaaaa', 'n_cccccc']);
    expect(geo.issues.features).toEqual([]);
  });

  it('signale les courbes impossibles à tenir', () => {
    let n = EMPTY_NETWORK;
    n = addNode(n, [2.0, 47.0], { id: 'n_aaaaaa' }).network;
    n = addNode(n, [2.01, 47.01], { id: 'n_cccccc' }).network;
    n = addSegment(n, 'n_aaaaaa', 'n_cccccc', {
      id: 's_ssssss',
      via: [[2.01, 47.0]],
      spec: {
        tracks: 2,
        gauge: 'standard',
        electrification: 'ac25k',
        signalling: 'ertms2',
        designSpeedKmh: 320,
      },
    }).network;
    const geo = networkToGeoJSON(n);
    expect(geo.issues.features.length).toBeGreaterThan(0);
    expect(geo.issues.features[0]?.properties.required).toBe(7000);
    expect(geo.segments.features[0]?.properties.issues).toBeGreaterThan(0);
  });

  it('prévisualise un tracé en cours comme le résultat final', () => {
    expect(previewPath([A, B, C], 160).length).toBeGreaterThan(10);
    expect(previewPath([A, B], 160)).toEqual([A, B]);
  });
});

describe('aimantation', () => {
  const project = ([lng, lat]: Position) => ({ x: lng * 100, y: lat * 100 });
  const node: SnapTarget = { kind: 'node', id: 'n_aaaaaa', position: [1, 1], label: '' };
  const station: SnapTarget = {
    kind: 'station',
    uic: '87686006',
    position: [1.05, 1],
    label: 'Paris Gare de Lyon',
  };

  it('retient la cible la plus proche dans le rayon', () => {
    expect(findSnap({ x: 104, y: 100 }, [node, station], project)).toBe(station);
    expect(findSnap({ x: 101, y: 100 }, [node, station], project)).toBe(node);
    expect(findSnap({ x: 200, y: 200 }, [node, station], project)).toBeNull();
  });

  it('préfère un nœud du réseau à distance égale', () => {
    const twin: SnapTarget = { ...station, position: [1, 1] };
    expect(findSnap({ x: 100, y: 100 }, [twin, node], project)).toBe(node);
  });
});

describe('état de l’éditeur', () => {
  it('trace un tronçon, le sélectionne et l’annule', () => {
    const store = new EditorStore();
    const id = store.finishDraw([{ position: A }, { position: B }, { position: C }]);
    expect(id).toMatch(/^s_/);
    expect(Object.keys(store.network.segments)).toEqual([id]);
    expect(store.network.segments[id ?? '']?.via).toEqual([B]);
    expect([...store.selection]).toEqual([id]);
    expect(store.canUndo).toBe(true);
    expect(store.undoLabel).toBe('Tracer un tronçon');
    store.undo();
    expect(store.network.segments).toEqual({});
    expect(store.selection.size).toBe(0);
    expect(store.canRedo).toBe(true);
    store.redo();
    expect(Object.keys(store.network.segments)).toHaveLength(1);
  });

  it('raccorde au réseau et reprend une gare réelle', () => {
    const store = new EditorStore(network());
    const id = store.finishDraw([
      { position: [2.21, 47.0], snap: { kind: 'node', id: 'n_aaaaaa', position: A, label: '' } },
      {
        position: [2.1, 47.1],
        snap: { kind: 'station', uic: '87574004', position: [2.1, 47.1], label: 'Vierzon' },
      },
    ]);
    const segment = store.network.segments[id ?? ''];
    expect(segment?.from).toBe('n_aaaaaa');
    expect(store.network.nodes[segment?.to ?? '']).toMatchObject({
      kind: 'station',
      name: 'Vierzon',
      station: { existingUic: '87574004' },
    });
    expect(store.network.nodes.n_aaaaaa?.kind).toBe('waypoint');
  });

  it('refuse un tracé dégénéré avec un message, sans rien modifier', () => {
    const store = new EditorStore(network());
    const snap: SnapTarget = { kind: 'node', id: 'n_aaaaaa', position: A, label: '' };
    expect(
      store.finishDraw([
        { position: A, snap },
        { position: A, snap },
      ]),
    ).toBeNull();
    expect(store.error).toMatch(/distincts/);
    expect(store.canUndo).toBe(false);
    expect(store.finishDraw([{ position: A }])).toBeNull();
  });

  it('fusionne un glisser en une seule étape et supprime la sélection', () => {
    const store = new EditorStore(network());
    for (let i = 1; i <= 10; i++) store.moveNode('n_aaaaaa', [2.2 + i * 0.001, 47.0]);
    store.endMove();
    expect(store.network.nodes.n_aaaaaa?.position).toEqual([2.21, 47.0]);
    store.undo();
    expect(store.network.nodes.n_aaaaaa?.position).toEqual(A);
    store.select('n_cccccc');
    store.select('s_ssssss', true);
    store.select('s_ssssss', true);
    expect([...store.selection]).toEqual(['n_cccccc']);
    store.deleteSelection();
    expect(Object.keys(store.network.nodes)).toEqual(['n_aaaaaa']);
    expect(store.network.segments).toEqual({});
    store.deleteSelection();
    expect(store.undoLabel).toBe('Supprimer');
  });

  it('change d’outil en effaçant le message d’erreur', () => {
    const store = new EditorStore();
    store.error = 'refus';
    store.setTool('draw');
    expect(store.tool).toBe('draw');
    expect(store.error).toBeNull();
  });

  it('trace une bifurcation en aboutissant sur un tronçon existant', () => {
    const store = new EditorStore(network());
    const id = store.finishDraw([
      {
        position: [2.3, 47.0],
        snap: { kind: 'segment', id: 's_ssssss', position: [2.3, 47.0], label: '' },
      },
      { position: [2.3, 46.9] },
    ]);
    const branch = store.network.segments[id ?? ''];
    const junction = store.network.nodes[branch?.from ?? ''];
    expect(junction?.kind).toBe('junction');
    expect(junction?.position).toEqual([2.3, 47.0]);
    expect(store.network.segments.s_ssssss).toBeUndefined();
    expect(Object.keys(store.network.segments)).toHaveLength(3);
    store.undo();
    expect(Object.keys(store.network.segments)).toEqual(['s_ssssss']);
  });

  it('fait d’un nœud une gare, la modifie puis la retire', () => {
    const store = new EditorStore(network());
    store.setStation('n_aaaaaa', { type: 'tgv', platforms: DEFAULT_PLATFORMS.tgv, terminus: true });
    expect(store.network.nodes.n_aaaaaa).toMatchObject({
      kind: 'station',
      station: { type: 'tgv', platforms: 6, terminus: true },
    });
    store.setStation('n_aaaaaa', null);
    expect(store.network.nodes.n_aaaaaa?.kind).toBe('waypoint');
    expect(store.network.nodes.n_aaaaaa?.station).toBeUndefined();
    expect(store.undoLabel).toBe('Retirer la gare');
  });

  it('renomme en une seule étape d’historique et retire un nom vide', () => {
    const store = new EditorStore(network());
    for (const name of ['B', 'Bo', 'Bourges']) store.renameNode('n_aaaaaa', name);
    store.seal();
    expect(store.network.nodes.n_aaaaaa?.name).toBe('Bourges');
    store.renameNode('n_aaaaaa', '  ');
    expect(store.network.nodes.n_aaaaaa?.name).toBeUndefined();
    store.undo();
    store.undo();
    expect(store.network.nodes.n_aaaaaa?.name).toBeUndefined();
    expect(store.canUndo).toBe(false);
  });

  it('modifie les caractéristiques d’un tronçon et le saut-de-mouton', () => {
    const store = new EditorStore(network());
    store.updateSpec('s_ssssss', { tracks: 4, designSpeedKmh: 220 });
    expect(store.network.segments.s_ssssss?.spec).toMatchObject({ tracks: 4, designSpeedKmh: 220 });
    store.setFlyover('n_aaaaaa', true);
    expect(store.network.nodes.n_aaaaaa?.flyover).toBe(true);
  });
});
