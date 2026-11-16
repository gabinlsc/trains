import type { Step } from '../pipeline.ts';
import { SOURCES } from '../sources.ts';
import { buildBoundaries } from './boundaries.ts';
import { buildAdminUnits, buildCommunes } from './communes.ts';
import {
  buildElevationGrid,
  GRID_SPEC,
  loadTiles,
  TERRARIUM_ZOOM,
  tileRange,
  tileUrl,
} from './elevation.ts';
import { FOREIGN_CITIES } from './foreign-cities.ts';
import { buildGares } from './gares.ts';
import { buildRivers, HydroPageSchema, hydrographyPageUrl, WFS_PAGE_SIZE } from './hydrography.ts';
import { buildProtectedAreas } from './protected-areas.ts';
import { buildRailLines } from './rail-lines.ts';

const json = (value: unknown): string => JSON.stringify(value);

export const communesStep: Step = {
  id: 'communes',
  async run(io) {
    const communes = buildCommunes(await io.json(SOURCES.communes));
    await io.write('communes.json', json(communes), communes.rows.length);
    const { departements, regions } = buildAdminUnits(
      await io.json(SOURCES.departements),
      await io.json(SOURCES.regions),
      communes,
    );
    await io.write('departements.json', json(departements), departements.length);
    await io.write('regions.json', json(regions), regions.length);
    await io.write('villes-etrangeres.json', json(FOREIGN_CITIES), FOREIGN_CITIES.length);
  },
};

export const garesStep: Step = {
  id: 'gares',
  async run(io) {
    const gares = buildGares(await io.json(SOURCES.gares));
    await io.write('gares.json', json(gares), gares.rows.length);
  },
};

export const railLinesStep: Step = {
  id: 'lignes-rfn',
  async run(io) {
    const lines = buildRailLines(await io.json(SOURCES.lignesRfn));
    await io.write('lignes-rfn.geojson', json(lines), lines.features.length);
  },
};

export const boundariesStep: Step = {
  id: 'limites-administratives',
  async run(io) {
    const regions = buildBoundaries(await io.gzipJson(SOURCES.contoursRegions));
    await io.write('limites-regions.geojson', json(regions), regions.features.length);
    const departements = buildBoundaries(await io.gzipJson(SOURCES.contoursDepartements));
    await io.write(
      'limites-departements.geojson',
      json(departements),
      departements.features.length,
    );
  },
};

export const hydrographyStep: Step = {
  id: 'cours-eau',
  async run(io) {
    // La première page donne le nombre total d'objets, d'où les pages suivantes.
    const first = await io.json(SOURCES.coursEau, hydrographyPageUrl(SOURCES.coursEau.url, 0));
    const total = HydroPageSchema.parse(first).numberMatched;
    const urls: string[] = [];
    for (let start = WFS_PAGE_SIZE; start < total; start += WFS_PAGE_SIZE) {
      urls.push(hydrographyPageUrl(SOURCES.coursEau.url, start));
    }
    io.log(`  ${total} tronçons, ${urls.length + 1} pages`);
    const pages = [first];
    for (const url of urls) pages.push(await io.json(SOURCES.coursEau, url));
    const rivers = buildRivers(pages);
    await io.write('cours-eau.geojson', json(rivers), rivers.features.length);
  },
};

export const protectedAreasStep: Step = {
  id: 'parcs-nationaux',
  async run(io) {
    const parks = buildProtectedAreas(await io.json(SOURCES.parcsNationaux));
    await io.write('parcs-nationaux.geojson', json(parks), parks.features.length);
  },
};

export const elevationStep: Step = {
  id: 'altitude',
  async run(io) {
    const range = tileRange(GRID_SPEC, TERRARIUM_ZOOM);
    const tiles: { x: number; y: number; url: string }[] = [];
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        tiles.push({ x, y, url: tileUrl(SOURCES.altitude.url, TERRARIUM_ZOOM, x, y) });
      }
    }
    io.log(`  ${tiles.length} tuiles, grille ${GRID_SPEC.cols} × ${GRID_SPEC.rows}`);
    const files = await io.files(
      SOURCES.altitude,
      tiles.map((t) => t.url),
      'png',
    );
    const store = await loadTiles(
      tiles.map((t, i) => ({ x: t.x, y: t.y, path: (files[i] as { path: string }).path })),
    );
    const grid = buildElevationGrid(store);
    await io.write('altitude.bin', grid, GRID_SPEC.cols * GRID_SPEC.rows);
  },
};

/** Ordre d'exécution : les étapes sont indépendantes, l'ordre ne sert qu'aux journaux. */
export const STEPS: readonly Step[] = [
  communesStep,
  garesStep,
  railLinesStep,
  boundariesStep,
  hydrographyStep,
  protectedAreasStep,
  elevationStep,
];
