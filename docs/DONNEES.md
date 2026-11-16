# Données

Rails de France s'appuie exclusivement sur des données ouvertes. Elles sont
téléchargées et transformées par `packages/data` au moment du déploiement,
puis servies depuis `DATA_DIR/data/<data-version>/`. Aucune donnée lourde
n'est versionnée dans le dépôt.

## Sources

URL et licences vérifiées le 16 novembre 2026. La liste exacte utilisée par
une génération (URL, date de récupération, empreinte SHA-256, taille) figure
dans son `manifest.json`.

| Identifiant             | Contenu                                                              | Producteur                                                      | Licence                             | Accès                                                                                         |
| ----------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `communes`              | Communes, populations légales, centres                               | INSEE, IGN (API Découpage administratif, DINUM)                 | Licence Ouverte 2.0                 | `geo.api.gouv.fr/communes`                                                                    |
| `departements`          | Départements et chefs-lieux (préfectures)                            | INSEE (API Découpage administratif)                             | Licence Ouverte 2.0                 | `geo.api.gouv.fr/departements`                                                                |
| `regions`               | Régions et chefs-lieux                                               | INSEE (API Découpage administratif)                             | Licence Ouverte 2.0                 | `geo.api.gouv.fr/regions`                                                                     |
| `gares`                 | Gares de voyageurs (2 792)                                           | SNCF Gares & Connexions                                         | ODbL 1.0                            | `ressources.data.sncf.com`, jeu `gares-de-voyageurs`                                          |
| `lignes-rfn`            | Lignes du réseau ferré national et statut                            | SNCF Réseau                                                     | ODbL 1.0                            | `ressources.data.sncf.com`, jeu `lignes-par-statut`                                           |
| `contours-regions`      | Contours des régions (généralisés à 100 m)                           | Etalab, d'après IGN Admin Express                               | Licence Ouverte 2.0                 | `etalab-datasets.geo.data.gouv.fr/contours-administratifs/2025`                               |
| `contours-departements` | Contours des départements (100 m)                                    | Etalab, d'après IGN Admin Express                               | Licence Ouverte 2.0                 | idem                                                                                          |
| `cours-eau`             | Tronçons hydrographiques de plus de 15 m de large                    | IGN, BD CARTO (Géoplateforme, WFS)                              | Licence Ouverte 2.0                 | `data.geopf.fr/wfs`, couche `BDCARTO_V5:troncon_hydrographique`                               |
| `parcs-nationaux`       | Cœurs et aires d'adhésion des parcs nationaux                        | Parcs nationaux de France (OFB)                                 | Licence Ouverte 2.0                 | `static.data.gouv.fr`, jeu « Contours des 11 Parcs nationaux de France » (empreinte vérifiée) |
| `altitude`              | Modèle numérique de terrain, tuiles Terrarium au zoom 9 (624 tuiles) | Terrain Tiles (AWS Open Data) : EU-DEM, SRTM, GMTED2010, ETOPO1 | Attribution requise (voir plus bas) | `s3.amazonaws.com/elevation-tiles-prod/terrarium`                                             |

Villes frontalières (Londres, Bruxelles, Genève, Bâle, Luxembourg, Turin,
Barcelone…) : liste établie à la main dans
`packages/data/src/steps/foreign-cities.ts`, avec la population de la ville
centre arrondie au millier d'après les offices statistiques nationaux.

### Fond de carte

Le fond de carte vectoriel est un extrait de l'archive mondiale Protomaps
(build quotidien, d'après OpenStreetMap), limité à l'emprise de travail et
au zoom 13. Il est produit par la commande `basemap`, distincte du pipeline
versionné :

| Élément                             | Source                                                                                                                    | Licence                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `tiles/france.pmtiles` (≈ 2,5–3 Go) | `build.protomaps.com/<AAAAMMJJ>.pmtiles`, dernier build au schéma v4 listé par `build-metadata.protomaps.dev/builds.json` | ODbL (© contributeurs OpenStreetMap), Protomaps |
| `tiles/assets/fonts/`               | glyphes Noto Sans (Regular, Medium, Italic), `protomaps.github.io/basemaps-assets`                                        | SIL Open Font License 1.1                       |
| `tiles/assets/sprites/v4/`          | sprites clair et sombre, même dépôt                                                                                       | BSD 3 clauses (Protomaps)                       |

L'extraction lit l'archive mondiale par requêtes HTTP Range : seules les
tuiles de l'emprise sont téléchargées. `tiles/france.json` décrit l'extrait
en service (build, schéma, date, empreinte SHA-256, nombre de tuiles) ; il
est refait si l'extrait manque, a plus de 90 jours, change de schéma, de
zoom maximal ou d'emprise.

### Choix et limites

- **Populations** : l'API Découpage administratif expose la population
  légale la plus récente publiée par l'INSEE, avec le centre de chaque
  commune. Elle évite d'apparier deux fichiers (populations et géographie)
  dont les millésimes diffèrent. Six communes « mortes pour la France »
  n'ont pas de population : elles comptent pour 0. L'outre-mer est exclu.
- **Lignes** : `lignes-par-statut` fournit à la fois le tracé et le statut
  de chaque tronçon. Il alimente le calque du réseau réel (statut
  « Exploitée ») et celui des lignes fermées. Les jeux ouverts de SNCF Réseau
  ne publient que des codes de ligne, pas de noms : le calque affiche donc le
  code. Le jeu date de 2022 côté producteur ; les ouvertures récentes peuvent
  manquer.
- **Outre-mer** : les fichiers amont mêlent DROM et collectivités d'outre-mer
  aux codes hétérogènes ; un objet est retenu si le centre de son emprise
  tombe dans la zone de travail (métropole, Corse, villes frontalières).
- **Cours d'eau** : seuls les tronçons de plus de 15 m de large (classes
  « Entre 15 et 50 m » et « Plus de 50 m » de la BD CARTO), non fictifs, sont
  retenus : ce sont ceux qui imposent un pont significatif. Les 85 000
  tronçons sont raccordés bout à bout par cours d'eau et classe de largeur,
  puis simplifiés (≈ 10 m), ce qui donne environ 7 000 lignes.
- **Parcs nationaux** : seuls les zonages terrestres sont retenus. Le cœur
  interdit toute construction, l'aire d'adhésion impose un surcoût. Les
  zonages marins et les parcs d'outre-mer sont écartés. Les autres espaces
  protégés (réserves naturelles, Natura 2000) ne sont pas encore pris en
  compte.
- **Altitude** : les tuiles Terrarium (Web Mercator, environ 210 m par
  pixel en France au zoom 9) sont rééchantillonnées par interpolation
  bilinéaire sur une grille géographique de 1/320° × 1/450° (≈ 245 m). Les
  sommets sont écrêtés par ce lissage (Mont Blanc : 4 686 m au lieu de
  4 806 m), sans effet sur des pentes calculées sur plusieurs centaines de
  mètres. En mer, la grille contient la bathymétrie (valeurs négatives). La
  réplique européenne du bucket refuse l'accès anonyme : le bucket principal
  est utilisé.
- **Gares** : une gare peut cumuler plusieurs segments DRG (`A;B`) et
  plusieurs codes UIC ; on retient le segment le plus élevé et le premier
  code UIC comme identifiant.

## Sorties

Pour chaque génération, dans `DATA_DIR/data/<data-version>/` :

| Fichier                                                   | Format                              | Contenu                                                                                                                           |
| --------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `communes.json`                                           | tableau colonnaire `{fields, rows}` | code INSEE, nom, département, population, longitude, latitude ; trié par population décroissante                                  |
| `departements.json`                                       | JSON                                | code, nom, région, chef-lieu (code, nom, position)                                                                                |
| `regions.json`                                            | JSON                                | code, nom, chef-lieu                                                                                                              |
| `gares.json`                                              | tableau colonnaire                  | UIC, nom, trigramme, segment, commune, position                                                                                   |
| `lignes-rfn.geojson`                                      | GeoJSON                             | tronçons simplifiés (tolérance ≈ 5 m), propriétés `code`, `status` (`open`, `neutralised`, `closed`) et `statut` d'origine        |
| `villes-etrangeres.json`                                  | JSON                                | villes frontalières                                                                                                               |
| `limites-regions.geojson`, `limites-departements.geojson` | GeoJSON                             | polygones, propriétés `code` et `nom`                                                                                             |
| `cours-eau.geojson`                                       | GeoJSON                             | lignes, propriétés `nom` et `largeur` (1 : 15 à 50 m, 2 : plus de 50 m)                                                           |
| `parcs-nationaux.geojson`                                 | GeoJSON                             | multipolygones, propriétés `nom` et `zone` (`coeur`, `adhesion`)                                                                  |
| `altitude.bin`                                            | binaire                             | grille d'altitude 5 120 × 4 680 en mètres (int16, 48 Mo, 26 Mo compressé) ; format décrit dans `packages/engine/src/elevation.ts` |
| `manifest.json`                                           | JSON                                | version, date, sources et sorties avec empreintes                                                                                 |

Les coordonnées sont en WGS84 (longitude, latitude), arrondies à 5
décimales (environ 1 m). Le tableau colonnaire divise la taille par trois
par rapport à un tableau d'objets.

## Version des données

`packages/data/src/version.ts` définit `DATA_VERSION` (`AAAA.MM.N`). Elle
est incrémentée à chaque changement de source ou de traitement. Au
déploiement, le pipeline ne fait rien si `DATA_DIR/data/<DATA_VERSION>/`
contient déjà un manifeste valide ; sinon il régénère tout.

## Robustesse

- Téléchargements avec délai maximal (2 min), cinq tentatives espacées
  exponentiellement pour les erreurs passagères (réseau, 429, 5xx, transfert
  tronqué), arrêt immédiat sur une erreur définitive (404, 403).
- Chaque fichier téléchargé est mis en cache avec son empreinte SHA-256 dans
  `DATA_DIR/cache/<data-version>/` ; une copie corrompue est retéléchargée.
  Une relance après échec ne retélécharge que ce qui manque.
- Les sources immuables peuvent déclarer une empreinte attendue
  (`sha256` dans `sources.ts`) : toute différence arrête le pipeline.
- Les réponses amont sont validées par des schémas Zod : un changement de
  format produit une erreur explicite plutôt que des données fausses.
- La génération se fait dans un dossier de travail renommé à la fin, puis le
  lien `current` est basculé atomiquement : jamais de données partielles en
  service. Un verrou empêche deux exécutions simultanées.
- Les deux générations les plus récentes sont conservées.

## Reproduire

```bash
pnpm --filter @trains/data build
DATA_DIR=./.local/data pnpm --filter @trains/data run pipeline   # --force pour régénérer
DATA_DIR=./.local/data pnpm --filter @trains/data run basemap    # fond de carte, --force idem
```

## Licences et attributions

- **Licence Ouverte 2.0 (Etalab)** : réutilisation libre avec mention de la
  source (« INSEE », « IGN », « Etalab », « Parcs nationaux de France »).
- **ODbL 1.0** (SNCF) : les bases dérivées (`gares.json`,
  `lignes-rfn.geojson`) restent sous ODbL et sont redistribuées avec la
  mention « © SNCF Gares & Connexions » et « © SNCF Réseau ».

- **Altitude** : « Produced using Copernicus data and information funded by
  the European Union – EU-DEM layers », « SRTM and GMTED2010 data courtesy of
  the U.S. Geological Survey », « ETOPO1 : NOAA National Centers for
  Environmental Information », via Terrain Tiles (AWS Open Data).

- **Fond de carte** : « © contributeurs OpenStreetMap » (ODbL) et
  « Protomaps ».

Ces mentions sont affichées en permanence sur la carte et détaillées sur la
page « Attributions des données ».
