import type { FeatureCollection } from 'geojson';
import type { LayerSpecification } from 'maplibre-gl';
import type { MessageKey } from '../../i18n/index.ts';
import { BASEMAP_SOURCE, type Theme } from '../style.ts';
import { loadDataFile, tableToPoints, type Table } from './data.ts';

export type LayerGroup = 'environment' | 'network' | 'population';

/**
 * Un calque activable : ses couches MapLibre, la donnée qui l'alimente
 * (chargée à la première activation) et sa légende.
 */
export interface OverlayDefinition {
  id: string;
  group: LayerGroup;
  label: MessageKey;
  defaultVisible: boolean;
  /** Couleur de la pastille de légende, par thème. */
  swatch: (theme: Theme) => string;
  /** Pastille en pointillés : la couleur n'est jamais seule porteuse d'information. */
  dashed?: boolean;
  /** Source GeoJSON propre au calque ; absente s'il repose sur le fond de carte. */
  load?: () => Promise<FeatureCollection>;
  /** Clé de donnée partagée : deux calques lisant le même fichier partagent la source. */
  dataKey?: string;
  layers: (theme: Theme) => LayerSpecification[];
  /** Couches du fond de carte masquées quand le calque est actif (doublons). */
  hidesBasemapLayers?: string[];
}

const FONT = ['Noto Sans Regular'];
const FONT_MEDIUM = ['Noto Sans Medium'];

/** Couleurs du texte et du halo, communes à tous les libellés. */
const ink = (theme: Theme) => (theme === 'dark' ? '#eef0f3' : '#14181f');
const halo = (theme: Theme) => (theme === 'dark' ? '#0f1318' : '#f6f4ef');

export const sourceId = (dataKey: string): string => `overlay-${dataKey}`;
export const dataKeyOf = (overlay: OverlayDefinition): string => overlay.dataKey ?? overlay.id;

export const OVERLAYS: readonly OverlayDefinition[] = [
  {
    id: 'urban',
    group: 'environment',
    label: 'layers.urban',
    defaultVisible: false,
    swatch: (t) => (t === 'dark' ? '#3a3330' : '#e8d6c8'),
    layers: (t) => [
      {
        id: 'urban-fill',
        type: 'fill',
        source: BASEMAP_SOURCE,
        'source-layer': 'landuse',
        filter: [
          'in',
          ['get', 'kind'],
          ['literal', ['residential', 'industrial', 'commercial', 'retail']],
        ],
        paint: { 'fill-color': t === 'dark' ? '#3a3330' : '#e8d6c8', 'fill-opacity': 0.7 },
      },
      {
        id: 'urban-landcover',
        type: 'fill',
        source: BASEMAP_SOURCE,
        'source-layer': 'landcover',
        filter: ['==', ['get', 'kind'], 'urban_area'],
        maxzoom: 10,
        paint: { 'fill-color': t === 'dark' ? '#3a3330' : '#e8d6c8', 'fill-opacity': 0.8 },
      },
    ],
  },
  {
    id: 'rivers',
    group: 'environment',
    label: 'layers.rivers',
    defaultVisible: false,
    swatch: (t) => (t === 'dark' ? '#3d7fa8' : '#3b7cb0'),
    load: () => loadDataFile('cours-eau.geojson'),
    layers: (t) => [
      {
        id: 'rivers-line',
        type: 'line',
        source: sourceId('rivers'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': t === 'dark' ? '#3d7fa8' : '#3b7cb0',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            ['*', 0.6, ['get', 'largeur']],
            12,
            ['*', 2, ['get', 'largeur']],
          ],
          'line-opacity': 0.85,
        },
      },
      {
        id: 'rivers-label',
        type: 'symbol',
        source: sourceId('rivers'),
        minzoom: 8,
        filter: ['!=', ['get', 'nom'], ''],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'nom'],
          'text-font': ['Noto Sans Italic'],
          'text-size': 11,
        },
        paint: {
          'text-color': t === 'dark' ? '#7fb3d5' : '#2d6690',
          'text-halo-color': halo(t),
          'text-halo-width': 1.2,
        },
      },
    ],
  },
  {
    id: 'parks',
    group: 'environment',
    label: 'layers.parks',
    defaultVisible: false,
    swatch: (t) => (t === 'dark' ? '#4f8a5b' : '#2f7a43'),
    load: () => loadDataFile('parcs-nationaux.geojson'),
    layers: (t) => [
      {
        id: 'parks-fill',
        type: 'fill',
        source: sourceId('parks'),
        paint: {
          'fill-color': t === 'dark' ? '#4f8a5b' : '#2f7a43',
          // Cœur plus marqué que l'aire d'adhésion : c'est là que la construction est interdite.
          'fill-opacity': ['match', ['get', 'zone'], 'coeur', 0.28, 0.1],
        },
      },
      {
        id: 'parks-outline',
        type: 'line',
        source: sourceId('parks'),
        paint: {
          'line-color': t === 'dark' ? '#6fae7b' : '#2f7a43',
          'line-width': ['match', ['get', 'zone'], 'coeur', 1.6, 0.8],
          'line-dasharray': [
            'match',
            ['get', 'zone'],
            'coeur',
            ['literal', [1, 0]],
            ['literal', [3, 2]],
          ],
        },
      },
    ],
  },
  {
    id: 'departments',
    group: 'environment',
    label: 'layers.departments',
    defaultVisible: false,
    swatch: (t) => (t === 'dark' ? '#6b7280' : '#8b8478'),
    dashed: true,
    load: () => loadDataFile('limites-departements.geojson'),
    layers: (t) => [
      {
        id: 'departments-line',
        type: 'line',
        source: sourceId('departments'),
        paint: {
          'line-color': t === 'dark' ? '#6b7280' : '#8b8478',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1.2],
          'line-dasharray': [4, 3],
        },
      },
    ],
  },
  {
    id: 'regions',
    group: 'environment',
    label: 'layers.regions',
    defaultVisible: false,
    swatch: (t) => (t === 'dark' ? '#9aa3b0' : '#5e646d'),
    load: () => loadDataFile('limites-regions.geojson'),
    layers: (t) => [
      {
        id: 'regions-line',
        type: 'line',
        source: sourceId('regions'),
        paint: {
          'line-color': t === 'dark' ? '#9aa3b0' : '#5e646d',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 10, 2.4],
          'line-opacity': 0.8,
        },
      },
    ],
  },
  {
    id: 'closed-lines',
    group: 'network',
    label: 'layers.closedLines',
    defaultVisible: false,
    swatch: (t) => (t === 'dark' ? '#b0865a' : '#9a6a3c'),
    dashed: true,
    dataKey: 'rfn',
    load: () => loadDataFile('lignes-rfn.geojson'),
    layers: (t) => [
      {
        id: 'closed-lines-line',
        type: 'line',
        source: sourceId('rfn'),
        filter: ['!=', ['get', 'status'], 'open'],
        paint: {
          'line-color': t === 'dark' ? '#b0865a' : '#9a6a3c',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 12, 2],
          'line-dasharray': [2, 2],
          'line-opacity': 0.8,
        },
      },
    ],
  },
  {
    id: 'real-network',
    group: 'network',
    label: 'layers.realNetwork',
    defaultVisible: true,
    swatch: (t) => (t === 'dark' ? '#8d95a3' : '#4a5260'),
    dataKey: 'rfn',
    load: () => loadDataFile('lignes-rfn.geojson'),
    layers: (t) => [
      {
        id: 'real-network-line',
        type: 'line',
        source: sourceId('rfn'),
        filter: ['==', ['get', 'status'], 'open'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        // Calque « fantôme » : présent pour comparer, jamais au premier plan.
        paint: {
          'line-color': t === 'dark' ? '#8d95a3' : '#4a5260',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 12, 2.4],
          'line-opacity': 0.45,
        },
      },
      {
        id: 'real-network-label',
        type: 'symbol',
        source: sourceId('rfn'),
        minzoom: 10,
        filter: ['==', ['get', 'status'], 'open'],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'code'],
          'text-font': FONT,
          'text-size': 10,
        },
        paint: {
          'text-color': t === 'dark' ? '#a9b1bd' : '#4a5260',
          'text-halo-color': halo(t),
          'text-halo-width': 1.2,
        },
      },
    ],
  },
  {
    id: 'stations',
    group: 'network',
    label: 'layers.stations',
    defaultVisible: false,
    swatch: (t) => (t === 'dark' ? '#eef0f3' : '#14181f'),
    load: async () => tableToPoints(await loadDataFile<Table>('gares.json')),
    layers: (t) => [
      {
        id: 'stations-circle',
        type: 'circle',
        source: sourceId('stations'),
        // Gares nationales visibles plus tôt que les haltes locales.
        filter: [
          'any',
          ['==', ['get', 'segment'], 'A'],
          ['>=', ['zoom'], ['match', ['get', 'segment'], 'B', 7, 9]],
        ],
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            ['match', ['get', 'segment'], 'A', 3, 2],
            12,
            ['match', ['get', 'segment'], 'A', 7, 'B', 5, 4],
          ],
          'circle-color': t === 'dark' ? '#151a21' : '#ffffff',
          'circle-stroke-color': ink(t),
          'circle-stroke-width': ['match', ['get', 'segment'], 'A', 2, 1.4],
        },
      },
      {
        id: 'stations-label',
        type: 'symbol',
        source: sourceId('stations'),
        minzoom: 9,
        layout: {
          'text-field': ['get', 'nom'],
          'text-font': FONT,
          'text-size': 11,
          'text-offset': [0, 0.9],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': ink(t), 'text-halo-color': halo(t), 'text-halo-width': 1.4 },
      },
    ],
  },
  {
    id: 'communes',
    group: 'population',
    label: 'layers.communes',
    defaultVisible: true,
    swatch: (t) => (t === 'dark' ? '#c9a227' : '#b08a12'),
    hidesBasemapLayers: ['places_locality', 'places_subplace'],
    load: async () =>
      tableToPoints(
        await loadDataFile<Table>('communes.json'),
        (c) => (c.population as number) >= 2000,
      ),
    layers: (t) => [
      {
        id: 'communes-circle',
        type: 'circle',
        source: sourceId('communes'),
        // Rayon proportionnel à la racine de la population : surface ∝ habitants.
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            ['*', 0.004, ['sqrt', ['get', 'population']]],
            11,
            ['*', 0.016, ['sqrt', ['get', 'population']]],
          ],
          'circle-color': t === 'dark' ? '#c9a227' : '#b08a12',
          'circle-opacity': 0.55,
          'circle-stroke-color': t === 'dark' ? '#e6c55a' : '#7d6210',
          'circle-stroke-width': 0.6,
        },
      },
      {
        id: 'communes-label',
        type: 'symbol',
        source: sourceId('communes'),
        // Les grandes villes d'abord ; les plus petites apparaissent en zoomant.
        filter: [
          '>=',
          ['get', 'population'],
          ['step', ['zoom'], 150000, 6, 50000, 7, 20000, 8, 8000, 9, 2000],
        ],
        layout: {
          'text-field': ['get', 'nom'],
          'text-font': [
            'step',
            ['get', 'population'],
            ['literal', FONT],
            100000,
            ['literal', FONT_MEDIUM],
          ],
          'text-size': [
            'interpolate',
            ['linear'],
            ['get', 'population'],
            2000,
            10,
            100000,
            13,
            2000000,
            17,
          ],
          'symbol-sort-key': ['-', ['get', 'population']],
          'text-padding': 3,
        },
        paint: { 'text-color': ink(t), 'text-halo-color': halo(t), 'text-halo-width': 1.4 },
      },
    ],
  },
];

export const GROUPS: readonly { id: LayerGroup; label: MessageKey }[] = [
  { id: 'network', label: 'layers.groups.network' },
  { id: 'population', label: 'layers.groups.population' },
  { id: 'environment', label: 'layers.groups.environment' },
];

/**
 * Mentions permanentes de toutes les données affichées (licences ODbL et
 * Licence Ouverte) : la carte les montre même avant tout chargement.
 */
export const DATA_ATTRIBUTIONS: readonly string[] = [
  'INSEE, IGN, Etalab',
  '© SNCF Réseau, SNCF Gares &amp; Connexions (ODbL)',
  'Parcs nationaux de France',
];
