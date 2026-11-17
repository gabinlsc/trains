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
  editor: {
    toolbar: 'Outils d’édition',
    select: 'Sélectionner (V)',
    draw: 'Tracer une voie (T)',
    undo: 'Annuler (Ctrl+Z)',
    redo: 'Rétablir (Ctrl+Maj+Z)',
    undoNamed: 'Annuler : {label}',
    redoNamed: 'Rétablir : {label}',
    delete: 'Supprimer la sélection (Suppr)',
    drawHint:
      'Cliquez pour poser des points, Entrée ou double-clic pour terminer, Échap pour annuler.',
    speed: 'Vitesse de conception',
    radius: 'Rayon minimal : {radius} m',
    issues: '{count} courbe(s) trop serrée(s) pour cette vitesse',
  },
  inspector: {
    title: 'Inspecteur',
    waypoint: 'Point de passage',
    junction: 'Bifurcation',
    station: 'Gare',
    segment: 'Tronçon',
    name: 'Nom',
    isStation: 'Gare voyageurs',
    stationType: 'Type',
    platforms: 'Quais',
    terminus: 'Terminus (gare en impasse)',
    existing: 'Gare existante, code UIC {uic}',
    flyover: 'Saut-de-mouton (croisement dénivelé)',
    branches: '{count} tronçon(s) raccordé(s)',
    length: 'Longueur : {km} km',
    tracks: 'Voies',
    speed: 'Vitesse',
    electrification: 'Électrification',
    signalling: 'Signalisation',
    gauge: 'Écartement',
    curves: 'Courbes trop serrées : {count}',
    multiple: '{count} éléments sélectionnés',
  },
  stationTypes: {
    halte: 'Halte',
    gare: 'Gare',
    correspondance: 'Pôle de correspondance',
    tgv: 'Gare TGV',
  },
  trackCounts: { '1': 'Voie unique', '2': 'Double voie', '4': 'Quadruple voie' },
  electrifications: {
    none: 'Non électrifiée',
    dc1500: '1,5 kV continu',
    ac25k: '25 kV alternatif',
  },
  signallings: { bapr: 'BAPR', bal: 'BAL', ertms2: 'ERTMS niveau 2' },
  gauges: { standard: 'Normal (1 435 mm)', metre: 'Métrique (1 000 mm)' },
  profile: {
    title: 'Profil en long',
    open: 'Afficher le profil en long',
    close: 'Masquer le profil en long',
    empty: 'Sélectionnez un tronçon pour afficher son profil en long.',
    loading: 'Calcul du profil…',
    unavailable: 'Profil indisponible : altitude non publiée sur ce serveur.',
    chart: 'Terrain et ligne rouge le long du tronçon sélectionné',
    terrain: 'Terrain',
    track: 'Voie',
    tunnel: 'Tunnel',
    viaduct: 'Viaduc',
    length: 'Longueur : {km} km',
    grade: 'Rampe maximale de la voie : {track} ‰ (limite {limit} ‰), du terrain : {terrain} ‰',
    structures: 'Tunnels : {tunnels} km · Viaducs : {viaducts} km',
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
