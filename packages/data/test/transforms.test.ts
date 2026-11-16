import { describe, expect, it } from 'vitest';
import { inDataBbox, roundCoord, simplifyLine, type Position } from '../src/geo.ts';
import { buildAdminUnits, buildCommunes } from '../src/steps/communes.ts';
import { FOREIGN_CITIES } from '../src/steps/foreign-cities.ts';
import { bestSegment, buildGares } from '../src/steps/gares.ts';
import { buildRailLines, classifyStatus } from '../src/steps/rail-lines.ts';

const commune = (
  code: string,
  nom: string,
  dep: string,
  population: number | undefined,
  lng: number,
  lat: number,
) => ({
  nom,
  code,
  codeDepartement: dep,
  codeRegion: '84',
  ...(population === undefined ? {} : { population }),
  centre: { type: 'Point', coordinates: [lng, lat] },
});

const RAW_COMMUNES = [
  commune('01053', 'Bourg-en-Bresse', '01', 41_000, 5.2281234, 46.2051),
  commune('69123', 'Lyon', '69', 519_127, 4.835, 45.758),
  commune('2A004', 'Ajaccio', '2A', 72_000, 8.7369, 41.9267),
  commune('55039', 'Beaumont-en-Verdunois', '55', undefined, 5.42, 49.27),
  commune('97411', 'Saint-Denis', '974', 150_000, 55.45, -20.88),
];

describe('géométrie', () => {
  it('arrondit à 5 décimales', () => {
    expect(roundCoord(2.123456789)).toBe(2.12346);
  });

  it('reconnaît l’emprise de travail, Corse et villes frontalières comprises', () => {
    expect(inDataBbox([8.7369, 41.9267])).toBe(true);
    expect(inDataBbox([-0.1263, 51.5309])).toBe(true);
    expect(inDataBbox([55.45, -20.88])).toBe(false);
  });

  it('supprime les points alignés et garde les inflexions', () => {
    const line: Position[] = [
      [0, 45],
      [0.001, 45],
      [0.002, 45],
      [0.003, 45.01],
      [0.004, 45.01],
    ];
    expect(simplifyLine(line, 1e-4)).toEqual([
      [0, 45],
      [0.002, 45],
      [0.003, 45.01],
      [0.004, 45.01],
    ]);
  });

  it('laisse intacte une ligne de deux points et gère les boucles fermées', () => {
    expect(
      simplifyLine(
        [
          [1, 1],
          [2, 2],
        ],
        1,
      ),
    ).toEqual([
      [1, 1],
      [2, 2],
    ]);
    const loop: Position[] = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0],
    ];
    expect(simplifyLine(loop, 1e-4)).toHaveLength(4);
  });
});

describe('communes', () => {
  const table = buildCommunes(RAW_COMMUNES);

  it('exclut l’outre-mer et trie par population décroissante', () => {
    expect(table.rows.map((r) => r[0])).toEqual(['69123', '2A004', '01053', '55039']);
  });

  it('compte à zéro une commune sans population', () => {
    expect(table.rows.find((r) => r[0] === '55039')?.[3]).toBe(0);
  });

  it('arrondit les coordonnées', () => {
    expect(table.rows.find((r) => r[0] === '01053')?.[4]).toBe(5.22812);
  });

  it('refuse une entrée mal formée', () => {
    expect(() => buildCommunes([{ nom: 'X' }])).toThrow();
  });

  it('rattache les chefs-lieux et ignore les régions d’outre-mer', () => {
    const { departements, regions } = buildAdminUnits(
      [
        { nom: 'Ain', code: '01', codeRegion: '84', chefLieu: '01053' },
        { nom: 'La Réunion', code: '974', codeRegion: '04', chefLieu: '97411' },
      ],
      [
        { nom: 'Auvergne-Rhône-Alpes', code: '84', chefLieu: '69123' },
        { nom: 'La Réunion', code: '04', chefLieu: '97411' },
      ],
      table,
    );
    expect(departements).toEqual([
      {
        code: '01',
        nom: 'Ain',
        region: '84',
        chefLieu: { code: '01053', nom: 'Bourg-en-Bresse', position: [5.22812, 46.2051] },
      },
    ]);
    expect(regions.map((r) => r.chefLieu.nom)).toEqual(['Lyon']);
  });

  it('signale un chef-lieu introuvable', () => {
    expect(() =>
      buildAdminUnits([{ nom: 'Ain', code: '01', codeRegion: '84', chefLieu: '99999' }], [], table),
    ).toThrow(/99999/);
  });
});

describe('gares', () => {
  const gare = (
    nom: string,
    segment: string | null,
    uic: string | null,
    lon = 2.35,
    lat = 48.88,
  ) => ({
    nom,
    libellecourt: 'PNO',
    segment_drg: segment,
    position_geographique: { lon, lat },
    codeinsee: '75110',
    codes_uic: uic,
  });

  it('retient le segment le plus élevé', () => {
    expect(bestSegment('C;B')).toBe('B');
    expect(bestSegment('A;B;A')).toBe('A');
    expect(bestSegment(null)).toBe('C');
  });

  it('dédoublonne par code UIC, ignore les positions absentes ou hors emprise', () => {
    const table = buildGares([
      gare('Paris Nord', 'A;B', '87271007;87271494'),
      gare('Paris Nord (doublon)', 'A', '87271007'),
      { ...gare('Sans position', 'C', '87000000'), position_geographique: null },
      gare('Saint-Denis Réunion', 'C', '87999999', 55.45, -20.88),
      gare('Halte sans UIC', null, null, 3.1, 45.2),
    ]);
    expect(table.rows.map((r) => [r[0], r[1], r[3]])).toEqual([
      ['87271007', 'Paris Nord', 'A'],
      ['', 'Halte sans UIC', 'C'],
    ]);
  });
});

describe('lignes RFN', () => {
  it('classe les statuts SNCF Réseau', () => {
    expect(classifyStatus('Exploitée')).toBe('open');
    expect(classifyStatus('S9A3 - Ligne en travaux')).toBe('open');
    expect(classifyStatus('Neutralisée et conservée pour les besoins de la Défense')).toBe(
      'neutralised',
    );
    expect(classifyStatus('Déclassée vendue')).toBe('closed');
    expect(classifyStatus('Transférée en voie de service')).toBe('closed');
  });

  it('simplifie, trie et ignore les géométries absentes', () => {
    const feature = (code: string, statut: string, coordinates: number[][] | null) => ({
      type: 'Feature',
      geometry: coordinates ? { type: 'LineString', coordinates } : null,
      properties: { code_ligne: code, statut, rg_troncon: 1 },
    });
    const result = buildRailLines({
      type: 'FeatureCollection',
      features: [
        feature('830000', 'Exploitée', [
          [5.0, 45.0],
          [5.000001, 45.0],
          [5.1, 45.0],
        ]),
        feature('420000', 'Fermée', [
          [2.0, 47.0],
          [2.1, 47.1],
        ]),
        feature('999000', 'Exploitée', null),
      ],
    });
    expect(result.features.map((f) => [f.properties.code, f.properties.status])).toEqual([
      ['420000', 'closed'],
      ['830000', 'open'],
    ]);
    expect(result.features[1]?.geometry.coordinates).toEqual([
      [5, 45],
      [5.1, 45],
    ]);
  });
});

describe('villes frontalières', () => {
  it('couvre les liaisons transfrontalières attendues, dans l’emprise', () => {
    const ids = FOREIGN_CITIES.map((c) => c.id);
    for (const id of [
      'bruxelles',
      'geneve',
      'bale',
      'luxembourg',
      'turin',
      'barcelone',
      'london',
    ]) {
      expect(ids).toContain(id);
    }
    expect(FOREIGN_CITIES.every((c) => inDataBbox(c.position) && c.population > 0)).toBe(true);
  });
});
