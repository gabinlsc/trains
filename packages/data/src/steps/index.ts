import type { Step } from '../pipeline.ts';
import { SOURCES } from '../sources.ts';
import { buildAdminUnits, buildCommunes } from './communes.ts';
import { FOREIGN_CITIES } from './foreign-cities.ts';
import { buildGares } from './gares.ts';
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

/** Ordre d'exécution : les étapes sont indépendantes, l'ordre ne sert qu'aux journaux. */
export const STEPS: readonly Step[] = [communesStep, garesStep, railLinesStep];
