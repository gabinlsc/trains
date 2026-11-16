import { describe, expect, it } from 'vitest';
import { bboxCenter, isInWorkArea, type Position } from '../src/geo.ts';
import { buildBoundaries } from '../src/steps/boundaries.ts';
import {
  buildRivers,
  chainSegments,
  hydrographyPageUrl,
  WFS_PAGE_SIZE,
} from '../src/steps/hydrography.ts';
import { buildProtectedAreas, normaliseParkName } from '../src/steps/protected-areas.ts';

const square = (lng: number, lat: number, size = 0.5): Position[] => [
  [lng, lat],
  [lng + size, lat],
  [lng + size, lat + size],
  [lng, lat + size],
  [lng, lat],
];

describe('zone de travail', () => {
  it('calcule le centre d’emprise quelle que soit l’imbrication', () => {
    expect(
      bboxCenter([
        [
          [0, 0],
          [2, 4],
        ],
      ]),
    ).toEqual([1, 2]);
    expect(bboxCenter([])).toBeNull();
  });

  it('retient la métropole et la Corse, écarte l’outre-mer', () => {
    expect(isInWorkArea([square(2, 47)])).toBe(true);
    expect(isInWorkArea([square(9, 42)])).toBe(true);
    expect(isInWorkArea([square(-61.5, 16)])).toBe(false);
    expect(isInWorkArea([square(166, -22)])).toBe(false);
  });
});

describe('limites administratives', () => {
  const feature = (code: string, nom: string, ring: Position[], multi = false) => ({
    type: 'Feature',
    properties: { code, nom, region: '84' },
    geometry: multi
      ? { type: 'MultiPolygon', coordinates: [[ring]] }
      : { type: 'Polygon', coordinates: [ring] },
  });

  it('exclut l’outre-mer, arrondit à 4 décimales et trie par code', () => {
    const result = buildBoundaries({
      type: 'FeatureCollection',
      features: [
        feature('69', 'Rhône', square(4.712345678, 45.7)),
        feature('971', 'Guadeloupe', square(-61.5, 16)),
        feature('988', 'Nouvelle-Calédonie', square(166, -22), true),
        feature('2A', 'Corse-du-Sud', square(8.9, 41.7), true),
      ],
    });
    expect(result.features.map((f) => f.properties)).toEqual([
      { code: '2A', nom: 'Corse-du-Sud' },
      { code: '69', nom: 'Rhône' },
    ]);
    const rhone = result.features[1]?.geometry;
    expect(rhone?.type === 'Polygon' && rhone.coordinates[0]?.[0]).toEqual([4.7123, 45.7]);
  });

  it('refuse une géométrie inattendue', () => {
    expect(() =>
      buildBoundaries({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { code: '01', nom: 'Ain' },
            geometry: { type: 'Point', coordinates: [5, 46] },
          },
        ],
      }),
    ).toThrow();
  });
});

describe('parcs nationaux', () => {
  const parc = (code: string, gest: string, polygons: Position[][][]) => ({
    properties: { code_r_enp: code, gest_site: gest, nom_site: 'x' },
    geometry: { type: 'MultiPolygon', coordinates: polygons },
  });

  it('garde cœurs et aires d’adhésion métropolitains, écarte le marin et l’outre-mer', () => {
    const result = buildProtectedAreas({
      type: 'FeatureCollection',
      features: [
        parc('CTPN', 'Parc national  des Calanques', [[square(5.4, 43.2)]]),
        parc('CMPN', 'Parc national des Calanques', [[square(5.3, 43.1)]]),
        parc('AAPN', 'Parc national des Ecrins', [[square(6.2, 44.8)]]),
        parc('CTPN', 'Parc amazonien de Guyane', [[square(-53, 3)]]),
      ],
    });
    expect(result.features.map((f) => f.properties)).toEqual([
      { nom: 'Parc national des Calanques', zone: 'coeur' },
      { nom: 'Parc national des Ecrins', zone: 'adhesion' },
    ]);
  });

  it('supprime les îlots devenus dégénérés et les trous minuscules', () => {
    const tiny: Position[] = [
      [6, 45],
      [6.00001, 45],
      [6.00001, 45.00001],
      [6, 45],
    ];
    const result = buildProtectedAreas({
      type: 'FeatureCollection',
      features: [
        parc('CTPN', 'Parc national de la Vanoise', [[square(6.5, 45.3), tiny], [tiny]]),
        parc('AAPN', 'Parc national de la Vanoise', [[tiny]]),
      ],
    });
    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.geometry.coordinates).toHaveLength(1);
    expect(result.features[0]?.geometry.coordinates[0]).toHaveLength(1);
  });

  it('normalise les espaces des noms', () => {
    expect(normaliseParkName(' Parc national  des Calanques ')).toBe('Parc national des Calanques');
  });
});

describe('cours d’eau', () => {
  it('construit des URL paginées stables et filtrées', () => {
    const url = new URL(hydrographyPageUrl('https://wfs.test/ows?SERVICE=WFS', WFS_PAGE_SIZE));
    expect(url.searchParams.get('STARTINDEX')).toBe('5000');
    expect(url.searchParams.get('SORTBY')).toBe('cleabs');
    expect(url.searchParams.get('SRSNAME')).toBe('CRS:84');
    expect(url.searchParams.get('CQL_FILTER')).toContain("'Plus de 50 m'");
  });

  it('raccorde les tronçons bout à bout, dans le désordre', () => {
    const chains = chainSegments([
      [
        [2, 0],
        [3, 0],
      ],
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [2, 0],
      ],
    ]);
    expect(chains).toEqual([
      [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
      ],
    ]);
  });

  it('garde séparées les branches d’une confluence et traite les boucles', () => {
    const confluence = chainSegments([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [0, 1],
        [1, 0],
      ],
      [
        [1, 0],
        [2, 0],
      ],
    ]);
    expect(confluence).toHaveLength(2);
    expect(confluence.flat().length).toBe(5);
    const loop = chainSegments([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [0, 0],
      ],
    ]);
    expect(loop).toEqual([
      [
        [0, 0],
        [1, 0],
        [0, 0],
      ],
    ]);
  });

  it('regroupe par cours d’eau et largeur, sur plusieurs pages', () => {
    const troncon = (
      classe: string,
      nom: string | null,
      code: string | null,
      coordinates: Position[],
    ) => ({
      geometry: { type: 'LineString', coordinates },
      properties: {
        classe_de_largeur: classe,
        cpx_toponyme_de_cours_d_eau: nom,
        code_du_cours_d_eau_bdcarthage: code,
      },
    });
    const result = buildRivers([
      {
        numberMatched: 4,
        features: [
          troncon('Plus de 50 m', 'la Loire', '----0000', [
            [0, 47],
            [0.5, 47],
          ]),
          troncon('Entre 15 et 50 m', 'le Lot', 'O8--0250', [
            [1, 44.5],
            [1.2, 44.5],
          ]),
        ],
      },
      {
        numberMatched: 4,
        features: [
          troncon('Plus de 50 m', 'la Loire', '----0000', [
            [0.5, 47],
            [1, 47.1],
          ]),
          {
            geometry: null,
            properties: {
              classe_de_largeur: null,
              cpx_toponyme_de_cours_d_eau: null,
              code_du_cours_d_eau_bdcarthage: null,
            },
          },
        ],
      },
    ]);
    expect(
      result.features.map((f) => [
        f.properties.nom,
        f.properties.largeur,
        f.geometry.coordinates.length,
      ]),
    ).toEqual([
      ['la Loire', 2, 3],
      ['le Lot', 1, 2],
    ]);
  });

  it('accepte les géométries multilignes et ignore les tronçons d’un seul point', () => {
    const result = buildRivers([
      {
        numberMatched: 1,
        features: [
          {
            geometry: {
              type: 'MultiLineString',
              coordinates: [
                [
                  [3, 45],
                  [3.1, 45],
                ],
                [[3.5, 45]],
              ],
            },
            properties: {
              classe_de_largeur: 'Entre 15 et 50 m',
              cpx_toponyme_de_cours_d_eau: null,
              code_du_cours_d_eau_bdcarthage: null,
            },
          },
        ],
      },
    ]);
    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.properties).toEqual({ nom: '', largeur: 1 });
  });
});
