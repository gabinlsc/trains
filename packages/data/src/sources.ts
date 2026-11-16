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
const CONTOURS = 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2025/geojson';
const IGN_WFS = 'https://data.geopf.fr/wfs/ows';

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
  contoursRegions: {
    id: 'contours-regions',
    title: 'Contours des régions (généralisés à 100 m)',
    producer: 'Etalab, d’après IGN Admin Express',
    license: 'Licence Ouverte 2.0 (Etalab)',
    url: `${CONTOURS}/regions-100m.geojson.gz`,
  },
  contoursDepartements: {
    id: 'contours-departements',
    title: 'Contours des départements (généralisés à 100 m)',
    producer: 'Etalab, d’après IGN Admin Express',
    license: 'Licence Ouverte 2.0 (Etalab)',
    url: `${CONTOURS}/departements-100m.geojson.gz`,
  },
  coursEau: {
    id: 'cours-eau',
    title: 'Tronçons hydrographiques de plus de 15 m de large',
    producer: 'IGN, BD CARTO (Géoplateforme)',
    license: 'Licence Ouverte 2.0 (Etalab)',
    url: `${IGN_WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDCARTO_V5:troncon_hydrographique`,
  },
  parcsNationaux: {
    id: 'parcs-nationaux',
    title: 'Contours des 11 parcs nationaux (cœurs et aires d’adhésion)',
    producer: 'Parcs nationaux de France (OFB)',
    license: 'Licence Ouverte 2.0 (Etalab)',
    url: 'https://static.data.gouv.fr/resources/contours-des-11-parcs-nationaux-de-france/20260211-094019/pnx-coeur-aa-ama.geojson',
    // Ressource horodatée, donc immuable : toute modification est une anomalie.
    sha256: '08079d80a0badec10304044a883ed00630f5bfd7a9f23d28e0bec64eedd597c3',
  },
  altitude: {
    id: 'altitude',
    title: 'Altitude : tuiles Terrarium au zoom 9',
    producer:
      'Terrain Tiles (AWS Open Data) : EU-DEM (Copernicus), SRTM et GMTED2010 (USGS), ETOPO1 (NOAA)',
    license:
      'Données ouvertes avec attribution (EU-DEM : Copernicus ; SRTM, GMTED2010, ETOPO1 : domaine public)',
    // Modèle d'URL ; les tuiles sont listées par l'étape.
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium',
  },
} as const satisfies Record<string, SourceDefinition>;

export type SourceKey = keyof typeof SOURCES;
