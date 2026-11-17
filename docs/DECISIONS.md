# Registre des décisions d'architecture

Chaque décision suit le format court : **contexte**, **décision**,
**conséquences**. Une décision remplacée n'est pas supprimée : elle est
marquée « Remplacée par ADR-xxx ».

---

## ADR-001 — Monorepo pnpm avec paquets internes en source TypeScript

**Contexte.** Le moteur de calcul doit tourner à l'identique dans le
navigateur (Web Worker) et sur le serveur (recalcul des scores). Les types et
schémas sont partagés par le front, l'API et le pipeline de données.

**Décision.** Monorepo pnpm workspaces. `packages/shared` et
`packages/engine` sont des paquets _internes_ : ils exposent directement leur
source TypeScript (`exports: ./src/index.ts`), sans étape de compilation
propre. Ce sont les applications qui les compilent : Vite pour le front, un
bundler pour le serveur.

**Conséquences.** Pas de `dist` à maintenir pour les paquets, pas de
désynchronisation entre source et build, rechargement à chaud immédiat. En
contrepartie, les paquets ne sont pas publiables tels quels sur npm, ce qui
n'est pas un objectif. Les imports relatifs portent l'extension `.ts`
(`allowImportingTsExtensions`), compréhensible par tous les outils de la
chaîne.

## ADR-002 — TypeScript 6.0 plutôt que 7.0

**Contexte.** TypeScript 7 (réécriture native) est sorti, mais
`typescript-eslint` exige encore `typescript < 6.1` pour l'analyse typée.

**Décision.** Épingler TypeScript `~6.0`. Réévaluer quand
`typescript-eslint` supportera la version 7.

**Conséquences.** Le lint typé (`strictTypeChecked`) reste disponible, au
prix d'un typage un peu plus lent que la version native.

## ADR-003 — Garde-fou de propreté du dépôt

**Contexte.** L'historique et le contenu du dépôt doivent rester exempts de
mentions d'outils de génération et de fichiers de configuration propres à
ces outils.

**Décision.** `scripts/check-clean.sh` contrôle les messages de commit de la
branche (par rapport à `origin/main`), le contenu versionné et la présence
de fichiers interdits. Il est appelé par le hook `pre-push`
(`simple-git-hooks`) et par la CI. Le script s'exclut lui-même du contrôle de
contenu puisqu'il porte les motifs recherchés.

**Conséquences.** Un push fautif est bloqué localement ; si le hook est
contourné, la CI échoue. Les notes de travail personnelles vont dans
`.git/info/exclude`, jamais dans `.gitignore`.

## ADR-004 — Hooks installés uniquement en développement

**Contexte.** `pnpm install` lance le script `prepare`. En production, la
release est une copie sans `.git` ; en CI, les hooks sont inutiles.

**Décision.** `scripts/install-hooks.mjs` n'installe les hooks que si un
dossier `.git` existe et que ni `CI` ni `NODE_ENV=production` ne sont
définis, et n'échoue jamais.

**Conséquences.** Le même `pnpm install --frozen-lockfile` fonctionne en
local, en CI et sur le serveur.

## ADR-005 — CI en jobs parallèles et indépendants

**Contexte.** Le merge n'est autorisé que si toutes les vérifications sont
vertes ; une règle de protection de branche s'appuie sur des noms de checks
stables.

**Décision.** Un workflow `CI` unique, un job par vérification (`lint`,
`typecheck`, `test`, `build`, `shellcheck`, `check-clean`, puis `e2e` et
`deploy-test` quand ils existeront). Chaque job installe ses dépendances avec
le cache pnpm de `actions/setup-node`. Le garde-fou s'exécute sur le commit de
tête de la PR avec l'historique complet. Pas de mises à jour automatiques de
dépendances : les commits générés par ces robots portent des trailers que le
dépôt refuse ; les montées de version se font par PR manuelle.

**Conséquences.** Retour rapide et lisible (le job en échec dit quoi
corriger), au prix de quelques installations redondantes, amorties par le
cache. Les noms de jobs servent de checks requis sur `main`.

## ADR-006 — Svelte 5 pour le front

**Contexte.** Le budget est de 300 kB gzip pour le bundle initial (hors fond
de carte), alors que MapLibre GL JS en consomme déjà environ 230 kB à lui
seul. L'éditeur manipule des milliers d'objets (tronçons, gares) dont l'état
change en continu (survol, sélection, recalcul des indicateurs).

**Décision.** Svelte 5 (runes) plutôt que React 19. Le compilateur ne laisse
qu'un runtime de quelques kilo-octets, et la réactivité fine (`$state`,
`$derived`) met à jour seulement ce qui change, sans réconciliation de DOM
virtuel ni mémoïsation manuelle. Pas de SvelteKit : l'application est une SPA
servie par Nginx, et le routage reste simple.

**Conséquences.** Marge confortable sur le budget (la page d'attente pèse
15 kB gzip). Écosystème de composants plus restreint que React, ce qui est
sans importance ici : l'interface est sur mesure. Les styles des composants
sont extraits en fichiers CSS, compatibles avec une CSP stricte.

## ADR-007 — Kysely et migrations embarquées

**Contexte.** SQLite via better-sqlite3, migrations versionnées, et un
serveur livré sous forme de bundle.

**Décision.** Kysely (constructeur de requêtes typé, paramétré par
construction) plutôt que Drizzle : pas de génération de code, et un
`Migrator` qui accepte un fournisseur de migrations en mémoire. Les
migrations sont importées statiquement (`src/db/migrate.ts`) et embarquées
dans le bundle. `dist/migrate.js` les applique ; deploy.sh l'appelle après
une sauvegarde `sqlite3 .backup`, et le serveur les rejoue au démarrage (sans
effet si la base est à jour).

**Conséquences.** Aucune requête SQL n'est construite par concaténation.
Chaque nouvelle migration doit être ajoutée à la table de `migrate.ts` (un
test vérifie la liste attendue).

## ADR-008 — Sémantique de /api/health

**Contexte.** deploy.sh déclenche un rollback automatique si le healthcheck
échoue ; une première installation peut se faire sans données
géographiques (`--skip-data`).

**Décision.** Le statut vaut `ok` (base et données présentes), `degraded`
(base saine, données absentes ou invalides) ou `error` (base injoignable ou
migrations en attente). Seul `error` répond 503. La réponse contient la
version, le commit court figé à la compilation, l'état de la base et la
version des données (`DATA_DIR/data/current/manifest.json`).

**Conséquences.** Un déploiement sans données passe le healthcheck tout en
restant visible comme dégradé dans la supervision.

## ADR-009 — Répartition des en-têtes de sécurité entre Nginx et l'API

**Contexte.** Les en-têtes de sécurité doivent être alignés entre l'API et
les fichiers statiques, sans doublons.

**Décision.** L'API pose ses propres en-têtes (`@fastify/helmet`, CSP
`default-src 'none'`, puisqu'elle ne sert que du JSON). Nginx pose ceux des
fichiers statiques et des tuiles, et ne les ajoute pas sur `/api/`.

**Conséquences.** Chaque réponse porte exactement un jeu d'en-têtes ; les
tests de l'API vérifient les siens, et un contrôle du vhost vérifie ceux de
Nginx.

## ADR-010 — Releases immuables et bascule par lien symbolique

**Contexte.** Le serveur héberge d'autres sites ; un déploiement raté ne
doit jamais laisser Rails de France dans un état intermédiaire, et le retour
arrière doit être immédiat.

**Décision.** Chaque commit déployé est extrait (`git archive`) dans
`/opt/trains/releases/<horodatage>-<sha>`, installé et construit sur place.
Le lien `current` n'est basculé (renommage atomique) qu'après un build
réussi et des migrations appliquées. Le healthcheck vérifie que l'API sert
bien le commit attendu ; sinon, retour automatique à la release précédente.
Un commit déjà en service n'est pas reconstruit, le service n'est pas
redémarré et aucune sauvegarde n'est créée : la relance est sans effet.

**Conséquences.** Rollback en une seconde (`--rollback`), au prix de
l'espace disque de `KEEP_RELEASES` releases (quelques centaines de Mo
chacune, `node_modules` compris ; le store pnpm partagé limite les
téléchargements). Les migrations doivent rester compatibles avec la release
précédente, puisque le rollback ne restaure pas la base.

## ADR-011 — Node.js système via NodeSource, avec garde-fou

**Contexte.** Node.js 22 est requis ; d'autres applications du serveur
peuvent dépendre d'une autre version installée globalement.

**Décision.** Node.js n'est installé (dépôt NodeSource) que s'il est absent
ou plus ancien que la version 22. Si une autre version majeure est
présente, le script liste les services systemd et pm2 qui semblent
l'utiliser et exige une confirmation explicite (`--yes` en non interactif).
pnpm est fourni par corepack, à la version épinglée dans `package.json`.

**Conséquences.** Aucune mise à niveau silencieuse de Node.js. Si une
application tierce impose une version plus ancienne, la voie de
contournement est un Node.js dédié (non automatisée, documentée dans
`DEPLOIEMENT.md`).

## ADR-012 — Test du déploiement dans un conteneur systemd

**Contexte.** `deploy.sh` est un livrable critique qui manipule systemd et
Nginx ; ShellCheck ne détecte pas les erreurs de comportement.

**Décision.** `deploy/test/run.sh` lance Ubuntu 24.04 avec systemd comme
PID 1 dans Docker et rejoue : installation, relance (configuration
strictement identique, aucune release, sauvegarde ni redémarrage
supplémentaire), mise à jour, release défectueuse (rollback automatique),
puis rollback manuel. Le job CI `deploy-test` l'exécute sur chaque PR.

**Conséquences.** Environ 4 minutes de CI par PR. HTTPS et données ne sont
pas couverts (`--skip-ssl --skip-data`) : ils dépendent du DNS réel et de
téléchargements volumineux.

## ADR-013 — Pipeline de données versionné, généré au déploiement

**Contexte.** Les données ouvertes pèsent de quelques Mo à plusieurs Go et
évoluent indépendamment du code ; elles ne doivent pas être versionnées dans
Git, mais chaque génération doit rester traçable.

**Décision.** `packages/data` est un programme Node (compilé par tsup comme
le serveur) qui télécharge chaque source avec reprises et cache vérifié,
valide les réponses par Zod, transforme en fonctions pures et écrit un
`manifest.json` (URL, date, SHA-256, tailles, comptes). Une constante
`DATA_VERSION` décide de la régénération ; la publication est atomique
(dossier de travail renommé, lien `current`).

**Conséquences.** Un déploiement sans changement de données ne télécharge
rien. Une source indisponible fait échouer le pipeline avec un message clair
et laisse la génération précédente en service. Les sources dynamiques (API)
ne sont pas strictement reproductibles octet pour octet : le manifeste
conserve l'empreinte de ce qui a réellement été utilisé.

## ADR-014 — Formats de sortie : JSON colonnaire et GeoJSON simplifié

**Contexte.** Le front charge ces fichiers au démarrage de la carte ; le
budget de performance est serré. FlatGeobuf était envisagé.

**Décision.** Points (communes, gares) en tableau colonnaire JSON, lignes et
surfaces en GeoJSON simplifié (Douglas-Peucker) aux coordonnées arrondies à
5 décimales. Altitude en grille binaire dédiée. Pas de FlatGeobuf pour ces
volumes : quelques Mo compressés par Nginx, directement consommables par
MapLibre.

**Conséquences.** Aucune dépendance de décodage côté client. À réévaluer si
une couche dépasse quelques dizaines de Mo (FlatGeobuf ou tuiles vectorielles
dédiées).

## ADR-015 — Grille d'altitude binaire dédiée, lue par le moteur

**Contexte.** Le moteur a besoin de l'altitude en tout point pour les
pentes, le profil en long, les tunnels et viaducs proposés, et les coûts ;
il tourne dans le navigateur et sur le serveur. Un MNT IGN au pas de 25 m
pèserait des gigaoctets.

**Décision.** Grille géographique régulière d'environ 245 m (1/320° ×
1/450°), en entiers 16 bits, précédée d'un en-tête de 64 octets
auto-descriptif (signature, dimensions, emprise, pas). Encodage, décodage et
échantillonnage bilinéaire sont dans `packages/engine/src/elevation.ts`,
réutilisé par le pipeline : un seul format, une seule implémentation.
Source : tuiles Terrarium, ouvertes et sans clé.

**Conséquences.** 48 Mo bruts (26 Mo compressés) : adapté au serveur, trop
lourd pour un chargement complet par le navigateur. La stratégie côté client
(tuilage de la grille ou échantillonnage par l'API) sera tranchée avec le
profil en long. `erasableSyntaxOnly` est activé dans TypeScript pour que le
moteur reste exécutable tel quel par Node et les outils qui ne font
qu'effacer les types.

## ADR-016 — Extraction du fond de carte écrite en TypeScript

**Contexte.** Le fond de carte doit être auto-hébergé : un extrait France de
l'archive Protomaps mondiale (140 Go), limité au zoom 13. L'outil de
référence (`pmtiles extract`, en Go) devrait être téléchargé sur le serveur
de production, partagé avec d'autres sites, et ne pouvait pas être éprouvé
dans notre chaîne d'intégration.

**Décision.** Extraction implémentée dans `packages/data/src/basemap/` :
lecture des répertoires par requêtes Range (feuilles comprises), sélection
des tuiles de l'emprise, regroupement des plages proches (moins de 512 Kio
d'écart), et écriture d'une archive PMTiles v3 en une seule passe (tuiles
puis métadonnées et feuilles, en-tête réécrit en tête). La bibliothèque
`pmtiles` sert à la lecture et à la vérification dans les tests. Le dernier
build au schéma v4 est choisi automatiquement ; l'état de l'extrait est
consigné dans `tiles/france.json`.

**Conséquences.** Aucun binaire tiers en production ; extraction testée sur
des archives synthétiques et vérifiée contre l'archive réelle (tuiles
identiques octet pour octet). Une extraction interrompue repart de zéro
(quelques minutes) au lieu de reprendre : chaque requête Range est retentée,
ce qui suffit en pratique. Les glyphes et sprites ne peuvent pas être
épinglés sur un commit (pas d'étiquette publiée) : leur empreinte est
consignée et revérifiée à chaque passage.

## ADR-017 — Carte MapLibre chargée à la demande, style sur mesure

**Contexte.** Le bundle initial doit rester sous 300 kB compressés ;
MapLibre GL JS en pèse à lui seul environ 280. Le fond de carte, ses glyphes
et ses sprites sont auto-hébergés, et la CSP interdit les scripts en ligne.

**Décision.** Routeur minimal (API History) : la page de carte est un module
chargé à la demande (`import()`), l'accueil ne charge ni MapLibre ni le
style. Le style est construit en code à partir des couches Protomaps
(`@protomaps/basemaps`), avec deux palettes propres : tons papier en clair,
nuit bleutée en sombre, routes et occupation du sol volontairement discrètes
pour que les lignes du joueur dominent. Le worker de MapLibre 6 est émis
comme fichier `.mjs` distinct (`setWorkerUrl`) : même origine, compatible
avec `worker-src 'self'`. Les attributions sont portées par le contrôle
d'attribution, donc visibles même si une source échoue. Le déplacement est
borné à l'emprise des données avec une marge (4° en longitude, 1° en
latitude) : un cadrage strict couperait le nord ou la Corse sur un écran
large ; la marge montre le fond uni, lu comme « hors zone ».

**Conséquences.** Accueil à 19 kB compressés ; carte à 330 kB, téléchargée
une fois puis mise en cache (fichiers fingerprintés). Nginx doit servir
`.mjs` comme JavaScript (types déclarés dans `/assets/`, contrôlé par le test
de déploiement).

## ADR-018 — Calques de données chargés à la demande

**Contexte.** La carte doit proposer une dizaine de calques activables (réseau
réel, lignes fermées, gares, communes, limites, cours d'eau, parcs, tache
urbaine), pour plusieurs mégaoctets de données au total, sans pénaliser
l'ouverture de la carte ni le changement de thème.

**Décision.** Un catalogue déclaratif (`map/layers/catalog.ts`) décrit chaque
calque : couches MapLibre par thème, donnée source, légende. Seuls les
calques actifs téléchargent leur fichier, sous `/data/<version>/` (cache
permanent), la version venant du manifeste courant. Deux calques lisant le
même fichier partagent la source. Après un changement de style (thème),
sources et couches sont réinstallées à partir du cache, sans
retéléchargement. Les choix sont mémorisés localement. Les communes
remplacent les libellés de localités du fond de carte pour éviter les
doublons ; la tache urbaine réutilise les zones urbaines du fond.

**Conséquences.** Par défaut, seuls le réseau réel (2,4 Mo, 0,7 Mo
compressé) et les communes sont chargés. Un fichier manquant n'affecte que
son calque, signalé dans le panneau. La légende associe à chaque couleur un
libellé et, pour les limites et lignes fermées, un motif pointillé.

## ADR-019 — Relief : tuiles Terrarium servies, courbes calculées par le navigateur

**Contexte.** La carte doit proposer un relief ombré et des courbes de
niveau, auto-hébergés. Des courbes précalculées pour toute la France
pèseraient des dizaines de mégaoctets par équidistance.

**Décision.** Le pipeline réécrit en pyramide (zooms 5 à 9) les tuiles
Terrarium déjà téléchargées pour la grille d'altitude, sous
`/data/<version>/relief/` (une seule entrée au manifeste). L'ombrage est
rendu par MapLibre (`raster-dem`) ; les courbes sont générées à la volée dans
un worker par `maplibre-contour`, à partir des mêmes tuiles, avec une
équidistance qui s'affine en zoomant. Ces sources ne sont créées qu'à
l'activation du calque, une fois la version connue.

**Conséquences.** Environ 106 Mo sur le serveur, quelques tuiles de 120 Ko
téléchargées à l'affichage. Au-delà du zoom 9, l'ombrage est suréchantillonné
(précision ≈ 200 m, cohérente avec la grille du moteur).
