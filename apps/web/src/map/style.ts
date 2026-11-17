import { DARK, LIGHT, layers, type Flavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';

export type Theme = 'light' | 'dark';

export const BASEMAP_SOURCE = 'protomaps';
export const BASEMAP_URL = '/tiles/france.pmtiles';
/**
 * Mentions affichées en permanence, y compris quand une source ne se charge
 * pas : elles sont portées par le contrôle d'attribution, pas par la source.
 */
export const BASEMAP_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>';

/**
 * Fond volontairement sourd : tons papier, routes discrètes, voies ferrées
 * existantes en gris. Les lignes du joueur, en couleurs franches, doivent
 * être ce qui se voit en premier.
 */
const PAPER: Partial<Flavor> = {
  background: '#efece4',
  earth: '#f6f4ef',
  water: '#b9d0df',
  park_a: '#e2e8d4',
  park_b: '#d9e2c8',
  wood_a: '#dfe6d0',
  wood_b: '#d6dfc5',
  scrub_a: '#e6e9d8',
  scrub_b: '#e1e5d1',
  glacier: '#f7fafc',
  sand: '#efe8d6',
  beach: '#f1ead6',
  buildings: '#e4e0d6',
  minor_a: '#ffffff',
  minor_b: '#ffffff',
  minor_service: '#fbfaf7',
  other: '#f3f1ec',
  link: '#ece6da',
  major: '#ebe5d8',
  highway: '#e3d9c5',
  minor_casing: '#e2ddd2',
  major_casing_early: '#d8d1c3',
  major_casing_late: '#d8d1c3',
  highway_casing_early: '#cfc4ae',
  highway_casing_late: '#cfc4ae',
  railway: '#a9a39a',
  boundaries: '#9b958b',
  roads_label_minor: '#7a7f88',
  roads_label_major: '#5e646d',
  city_label: '#14181f',
  city_label_halo: '#f6f4ef',
  subplace_label: '#4a5260',
  subplace_label_halo: '#f6f4ef',
  state_label: '#6b7280',
  state_label_halo: '#f6f4ef',
  country_label: '#4a5260',
  ocean_label: '#5d7c92',
  // Occupation du sol aux petits zooms : à peine teintée, pour rester un fond.
  landcover: {
    forest: '#e1e7d3',
    farmland: '#f2f0e6',
    grassland: '#eaeddc',
    scrub: '#e6e9d8',
    barren: '#efebe2',
    glacier: '#f7fafc',
    urban_area: '#e7e3da',
  },
};

const NIGHT: Partial<Flavor> = {
  background: '#0f1318',
  earth: '#151a21',
  water: '#0d2231',
  park_a: '#18221d',
  park_b: '#1a251f',
  wood_a: '#18221c',
  wood_b: '#1a241e',
  buildings: '#1f252e',
  minor_a: '#232a34',
  minor_b: '#232a34',
  minor_service: '#1e242d',
  other: '#1c222a',
  link: '#2a313c',
  major: '#2b333e',
  highway: '#353e4b',
  railway: '#4b5260',
  boundaries: '#566070',
  roads_label_minor: '#7f8794',
  roads_label_major: '#98a0ac',
  city_label: '#eef0f3',
  city_label_halo: '#0f1318',
  subplace_label: '#a9b1bd',
  subplace_label_halo: '#0f1318',
  state_label: '#8b93a0',
  state_label_halo: '#0f1318',
  country_label: '#a9b1bd',
  ocean_label: '#6f8ea3',
  landcover: {
    forest: '#172019',
    farmland: '#161b21',
    grassland: '#171d1c',
    scrub: '#171d1b',
    barren: '#191d23',
    glacier: '#1f2731',
    urban_area: '#1c2129',
  },
};

export function flavorFor(theme: Theme): Flavor {
  return theme === 'dark' ? { ...DARK, ...NIGHT } : { ...LIGHT, ...PAPER };
}

/**
 * Style complet, entièrement auto-hébergé : tuiles, glyphes et sprites sont
 * servis par Nginx sous /tiles/. MapLibre exige des URL absolues.
 */
export function buildStyle(theme: Theme, origin: string): StyleSpecification {
  return {
    version: 8,
    glyphs: `${origin}/tiles/assets/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/tiles/assets/sprites/v4/${theme}`,
    sources: {
      [BASEMAP_SOURCE]: {
        type: 'vector',
        url: `pmtiles://${origin}${BASEMAP_URL}`,
      },
    },
    layers: layers(BASEMAP_SOURCE, flavorFor(theme), { lang: 'fr' }),
  };
}
