/**
 * Catalogue des sources ouvertes. Chaque entrée est reprise telle quelle dans
 * le manifeste et dans docs/DONNEES.md. Les URL ont été vérifiées à la date
 * de DATA_VERSION ; une `sha256` n'est renseignée que pour les fichiers amont
 * immuables (les API renvoient un contenu qui évolue).
 */
export interface SourceDefinition {
  id: string;
  title: string;
  producer: string;
  license: string;
  url: string;
  sha256?: string;
}

const SNCF = 'https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets';
const GEO_API = 'https://geo.api.gouv.fr';

export const SOURCES = {
  communes: {
    id: 'communes',
    title: 'Communes : populations légales et centres',
    producer: 'INSEE et IGN, via l’API Découpage administratif (DINUM)',
    license: 'Licence Ouverte 2.0 (Etalab)',
    url: `${GEO_API}/communes?type=commune-actuelle&fields=nom,code,codeDepartement,codeRegion,population,centre&format=json`,
  },
  departements: {
    id: 'departements',
    title: 'Départements et chefs-lieux',
    producer: 'INSEE, via l’API Découpage administratif (DINUM)',
    license: 'Licence Ouverte 2.0 (Etalab)',
    url: `${GEO_API}/departements?fields=nom,code,codeRegion,chefLieu`,
  },
  regions: {
    id: 'regions',
    title: 'Régions et chefs-lieux',
    producer: 'INSEE, via l’API Découpage administratif (DINUM)',
    license: 'Licence Ouverte 2.0 (Etalab)',
    url: `${GEO_API}/regions?fields=nom,code,chefLieu`,
  },
  gares: {
    id: 'gares',
    title: 'Gares de voyageurs',
    producer: 'SNCF Gares & Connexions',
    license: 'ODbL 1.0',
    url: `${SNCF}/gares-de-voyageurs/exports/json?select=nom,libellecourt,segment_drg,position_geographique,codeinsee,codes_uic`,
  },
  lignesRfn: {
    id: 'lignes-rfn',
    title: 'Lignes du réseau ferré national par statut',
    producer: 'SNCF Réseau',
    license: 'ODbL 1.0',
    url: `${SNCF}/lignes-par-statut/exports/geojson?select=code_ligne,lib_ligne,statut,rg_troncon,geo_shape`,
  },
} as const satisfies Record<string, SourceDefinition>;

export type SourceKey = keyof typeof SOURCES;
