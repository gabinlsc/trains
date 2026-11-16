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
    diagramLabel: 'Schéma de la ligne A, de Brest à Strasbourg, desservant cinq gares',
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
