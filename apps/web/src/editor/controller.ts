import type { FeatureCollection } from 'geojson';
import type { Id, Position } from '@trains/shared';
import type {
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapMouseEvent,
} from 'maplibre-gl';
import type { Theme } from '../map/style.ts';
import { networkToGeoJSON, previewPath } from './geometry.ts';
import { findSnap, type SnapTarget } from './snap.ts';
import type { DraftPoint, EditorStore } from './store.svelte.ts';

const SRC = {
  segments: 'editor-segments',
  nodes: 'editor-nodes',
  issues: 'editor-issues',
  draft: 'editor-draft',
} as const;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Couleur des lignes du joueur : franche, distincte du réseau réel en gris. */
const PLAYER = { light: '#c8102e', dark: '#ff6b7f' } as const;

function layers(theme: Theme): LayerSpecification[] {
  const ink = theme === 'dark' ? '#eef0f3' : '#14181f';
  const paper = theme === 'dark' ? '#151a21' : '#ffffff';
  const accent = PLAYER[theme];
  return [
    {
      id: 'editor-segments-casing',
      type: 'line',
      source: SRC.segments,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': paper,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 9],
      },
    },
    {
      id: 'editor-segments',
      type: 'line',
      source: SRC.segments,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': accent,
        // Épaisseur selon le nombre de voies : unique, double, quadruple.
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          5,
          ['match', ['get', 'tracks'], 1, 1.5, 4, 3.5, 2.5],
          12,
          ['match', ['get', 'tracks'], 1, 3, 4, 7, 5],
        ],
      },
    },
    {
      id: 'editor-segments-selected',
      type: 'line',
      source: SRC.segments,
      filter: ['in', ['get', 'id'], ['literal', []]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ink,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 12, 4],
        'line-dasharray': [2, 1.5],
      },
    },
    {
      id: 'editor-draft',
      type: 'line',
      source: SRC.draft,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': accent,
        'line-width': 3,
        'line-opacity': 0.7,
        'line-dasharray': [1.5, 1],
      },
    },
    {
      id: 'editor-issues',
      type: 'circle',
      source: SRC.issues,
      paint: {
        'circle-radius': 7,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#f2a900',
        'circle-stroke-width': 2.5,
      },
    },
    {
      id: 'editor-nodes',
      type: 'circle',
      source: SRC.nodes,
      paint: {
        'circle-radius': ['match', ['get', 'kind'], 'station', 6, 'junction', 5, 3.5],
        'circle-color': ['match', ['get', 'kind'], 'station', paper, accent],
        'circle-stroke-color': ['match', ['get', 'kind'], 'station', ink, paper],
        'circle-stroke-width': ['match', ['get', 'kind'], 'station', 2.5, 1.5],
      },
    },
    {
      id: 'editor-nodes-selected',
      type: 'circle',
      source: SRC.nodes,
      filter: ['in', ['get', 'id'], ['literal', []]],
      paint: {
        'circle-radius': 9,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': ink,
        'circle-stroke-width': 2,
      },
    },
    {
      id: 'editor-nodes-label',
      type: 'symbol',
      source: SRC.nodes,
      filter: ['!=', ['get', 'name'], ''],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Medium'],
        'text-size': 12,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
      },
      paint: { 'text-color': ink, 'text-halo-color': paper, 'text-halo-width': 1.5 },
    },
  ];
}

/**
 * Relie l'éditeur à la carte : couches du réseau du joueur, saisie du tracé
 * avec aimantation, sélection et déplacement des nœuds.
 */
export class EditorController {
  private draft: DraftPoint[] = [];
  private hover: DraftPoint | null = null;
  private dragging: Id | null = null;
  private theme: Theme;
  /** Gares réelles proposées à l'aimantation (chargées par la page). */
  stations: SnapTarget[] = [];

  private readonly map: MapLibreMap;
  private readonly store: EditorStore;

  constructor(map: MapLibreMap, store: EditorStore, theme: Theme) {
    this.map = map;
    this.store = store;
    this.theme = theme;
    map.on('style.load', () => {
      this.install();
    });
    map.on('click', (e) => {
      this.onClick(e);
    });
    map.on('dblclick', (e) => {
      if (this.store.tool === 'draw') {
        e.preventDefault();
        this.finish();
      }
    });
    map.on('mousemove', (e) => {
      this.onMove(e);
    });
    map.on('mousedown', 'editor-nodes', (e) => {
      this.onNodeDown(e);
    });
    map.on('mouseup', () => {
      if (this.dragging) {
        this.store.endMove();
        this.dragging = null;
        map.dragPan.enable();
      }
    });
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  get drafting(): boolean {
    return this.draft.length > 0;
  }

  private install(): void {
    for (const id of Object.values(SRC)) {
      if (!this.map.getSource(id)) this.map.addSource(id, { type: 'geojson', data: EMPTY });
    }
    for (const layer of layers(this.theme)) {
      if (!this.map.getLayer(layer.id)) this.map.addLayer(layer);
    }
    this.render();
  }

  /** Redessine le réseau et la sélection (appelé à chaque changement d'état). */
  render(network = this.store.network, selection: readonly Id[] = [...this.store.selection]): void {
    if (!this.map.getSource(SRC.segments)) return;
    const geo = networkToGeoJSON(network);
    void this.map.getSource<GeoJSONSource>(SRC.segments)?.setData(geo.segments);
    void this.map.getSource<GeoJSONSource>(SRC.nodes)?.setData(geo.nodes);
    void this.map.getSource<GeoJSONSource>(SRC.issues)?.setData(geo.issues);
    const selected = ['in', ['get', 'id'], ['literal', [...selection]]] as const;
    this.map.setFilter('editor-segments-selected', selected as never);
    this.map.setFilter('editor-nodes-selected', selected as never);
    this.renderDraft();
  }

  private renderDraft(): void {
    const points = [...this.draft, ...(this.hover ? [this.hover] : [])].map(
      (p) => p.snap?.position ?? p.position,
    );
    const path = points.length >= 2 ? previewPath(points, this.store.spec.designSpeedKmh) : [];
    void this.map.getSource<GeoJSONSource>(SRC.draft)?.setData(
      path.length >= 2
        ? {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: path.map((p) => [p[0], p[1]]) },
            properties: {},
          }
        : EMPTY,
    );
  }

  private candidates(): SnapTarget[] {
    const nodes: SnapTarget[] = Object.values(this.store.network.nodes).map((n) => ({
      kind: 'node',
      id: n.id,
      position: n.position,
      label: n.name ?? '',
    }));
    return [...nodes, ...this.stations];
  }

  private pointAt(e: MapMouseEvent): DraftPoint {
    const position: Position = [e.lngLat.lng, e.lngLat.lat];
    const snap = findSnap(e.point, this.candidates(), (p) => this.map.project(p));
    return { position, snap };
  }

  private onClick(e: MapMouseEvent): void {
    if (this.store.tool === 'draw') {
      this.draft.push(this.pointAt(e));
      this.renderDraft();
      return;
    }
    const hit = this.map.queryRenderedFeatures(e.point, {
      layers: ['editor-nodes', 'editor-segments'],
    })[0];
    const id = hit?.properties.id as Id | undefined;
    const additive = e.originalEvent.shiftKey;
    if (id) this.store.select(id, additive);
    else if (!additive) this.store.clearSelection();
  }

  private onMove(e: MapMouseEvent): void {
    if (this.dragging) {
      this.store.moveNode(this.dragging, [e.lngLat.lng, e.lngLat.lat]);
      return;
    }
    if (this.store.tool === 'draw') {
      this.hover = this.pointAt(e);
      this.map.getCanvas().style.cursor = this.hover.snap ? 'pointer' : 'crosshair';
      this.renderDraft();
    } else {
      const hit =
        this.map.queryRenderedFeatures(e.point, { layers: ['editor-nodes', 'editor-segments'] })
          .length > 0;
      this.map.getCanvas().style.cursor = hit ? 'pointer' : '';
    }
  }

  private onNodeDown(e: MapLayerMouseEvent): void {
    if (this.store.tool !== 'select') return;
    const id = e.features?.[0]?.properties.id as Id | undefined;
    if (!id) return;
    e.preventDefault();
    this.dragging = id;
    this.store.select(id);
    this.map.dragPan.disable();
  }

  /** Termine le tracé en cours (Entrée, double-clic). */
  finish(): void {
    // Un double-clic ajoute deux points identiques : on les dédoublonne.
    const points = this.draft.filter((p, i, all) => {
      const prev = all[i - 1];
      return prev?.position[0] !== p.position[0] || prev.position[1] !== p.position[1];
    });
    this.store.finishDraw(points);
    this.cancel();
  }

  /** Abandonne le tracé en cours (Échap). */
  cancel(): void {
    this.draft = [];
    this.hover = null;
    this.renderDraft();
  }

  /** Retire le dernier point saisi (Retour arrière). */
  undoPoint(): void {
    this.draft.pop();
    this.renderDraft();
  }
}
