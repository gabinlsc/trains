/**
 * Catalogue français, langue de référence. Toute nouvelle clé est ajoutée
 * ici d'abord : son type sert de contrat aux autres langues.
 */
export const fr = {
  app: {
    name: 'Rails de France',
    tagline: 'Construisez le réseau ferroviaire français de vos rêves.',
  },
  landing: {
    status: 'Bientôt disponible',
    pitch:
      'Tracez des voies sur la carte réelle de la France, placez des gares, créez des lignes : le jeu calcule aussitôt le coût, les temps de parcours, la fréquentation et l’impact carbone.',
    features: {
      build: {
        code: 'A',
        title: 'Infrastructure',
        text: 'Voies, ouvrages d’art, gares et raccordements, avec relief et zones protégées.',
      },
      services: {
        code: 'B',
        title: 'Dessertes',
        text: 'Lignes TGV, Intercités, TER ou RER, matériel roulant réaliste, fréquences.',
      },
      impact: {
        code: 'C',
        title: 'Conséquences',
        text: 'Coûts, temps de parcours, fréquentation, rentabilité et CO₂ évité.',
      },
    },
    openMap: 'Ouvrir la carte',
    diagramLabel: 'Schéma de la ligne A, de Brest à Strasbourg, desservant cinq gares',
  },
  nav: {
    home: 'Accueil',
    map: 'Carte',
  },
  theme: {
    toLight: 'Passer au thème clair',
    toDark: 'Passer au thème sombre',
  },
  map: {
    title: 'Carte',
    label: 'Carte de la France',
    loading: 'Chargement de la carte…',
    basemapUnavailable:
      'Fond de carte indisponible pour le moment : les données ferroviaires restent consultables.',
    webglUnavailable: 'Votre navigateur ne permet pas d’afficher la carte (WebGL indisponible).',
  },
  layers: {
    title: 'Calques',
    open: 'Afficher les calques',
    close: 'Masquer les calques',
    loading: 'chargement…',
    error: 'données indisponibles',
    groups: {
      network: 'Réseau ferré',
      population: 'Population',
      environment: 'Territoire',
    },
    realNetwork: 'Réseau ferré actuel',
    closedLines: 'Lignes fermées ou neutralisées',
    stations: 'Gares voyageurs',
    communes: 'Communes de 2 000 habitants ou plus',
    urban: 'Tache urbaine',
    hillshade: 'Relief ombré',
    contours: 'Courbes de niveau',
    rivers: 'Fleuves et grandes rivières',
    parks: 'Parcs nationaux (cœur et aire d’adhésion)',
    departments: 'Limites des départements',
    regions: 'Limites des régions',
  },
  notFound: {
    title: 'Page introuvable',
    text: 'Cette adresse ne correspond à aucune page.',
    back: 'Retour à l’accueil',
  },
  footer: {
    attribution: 'Données : © contributeurs OpenStreetMap, INSEE, SNCF, IGN.',
  },
} as const;

/** Forme du catalogue : les autres langues doivent fournir les mêmes clés. */
export type Messages = DeepStringRecord<typeof fr>;

type DeepStringRecord<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : DeepStringRecord<T[K]>;
};
