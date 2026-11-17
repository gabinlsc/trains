# Journal des modifications

Toutes les évolutions notables de ce projet sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et
le projet adhère au [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté

- Modèle du réseau (nœuds, tronçons, gares, ouvrages d'art) validé par Zod,
  opérations d'édition immuables (ajout, déplacement, scission, fusion,
  suppression en cascade, copier-coller) et historique d'annulation
  illimité.

## [0.2.0] — 2026-11-17

Phase 1 — Carte : données ouvertes, fond de carte auto-hébergé et calques.

### Ajouté

- `packages/data` : pipeline de données ouvertes versionné (`DATA_VERSION`),
  téléchargements avec reprises, cache vérifié par SHA-256, validation Zod,
  publication atomique avec manifeste et verrou.
- Communes et populations légales, départements et régions avec
  chefs-lieux (INSEE), gares de voyageurs (SNCF), lignes du réseau ferré
  national par statut (SNCF Réseau), villes frontalières.
- Limites des régions et départements (Etalab, d'après IGN Admin Express),
  cours d'eau de plus de 15 m de large (IGN BD CARTO, via le WFS de la
  Géoplateforme, pagination et raccordement des tronçons), cœurs et aires
  d'adhésion des parcs nationaux (Parcs nationaux de France).
- Grille d'altitude d'environ 245 m sur toute l'emprise, à partir des tuiles
  Terrarium ; format binaire et échantillonnage bilinéaire dans
  `packages/engine`.
- Fond de carte auto-hébergé : extraction de l'emprise France (zoom 13)
  depuis l'archive mondiale Protomaps par requêtes Range, glyphes et sprites
  auto-hébergés, rafraîchissement tous les 90 jours (commande `basemap`).
- Nginx sert les données publiées sous `/data/` (cache immuable par version)
  et le fond de carte sous `/tiles/`.
- Carte MapLibre (`/carte`) sur le fond PMTiles auto-hébergé, style sur
  mesure en thèmes clair et sombre, libellés en français, attributions
  permanentes, message explicite si le fond de carte ou WebGL manque.
- Calques activables : réseau ferré actuel (fantôme), lignes fermées ou
  neutralisées, gares voyageurs, communes de 2 000 habitants ou plus (taille
  proportionnelle), tache urbaine, cours d'eau, parcs nationaux, limites
  des départements et des régions ; panneau accessible au clavier avec
  légende, choix mémorisés, attributions de toutes les sources.
- Relief ombré et courbes de niveau (cotes en mètres), à partir de tuiles
  d'altitude produites par le pipeline ; courbes calculées dans un worker.
- Routage côté client, page 404, bascule de thème mémorisée.
- Tests de bout en bout Playwright (job CI `e2e`).
- `docs/DONNEES.md` : sources, licences, formats et choix de traitement.

### Corrigé

- Plus d'avertissement de dépréciation de Fastify au démarrage de l'API.

### Modifié

- Les réponses HTTP 400 intermittentes du WFS de la Géoplateforme sont
  retentées au lieu d'interrompre le pipeline.
- Un échec du pipeline de données ou du fond de carte n'interrompt plus le
  déploiement : la génération précédente reste en service.

## [0.1.0] — 2026-11-16

Phase 0 — Fondations : le projet est outillé, testé et déployable.

### Ajouté

- Monorepo pnpm (`apps/*`, `packages/*`), TypeScript strict, ESLint, Prettier, Vitest.
- `packages/shared` : caractéristiques de voie (nombre de voies, écartement,
  électrification, signalisation, vitesse de conception) validées par Zod.
- `packages/engine` : primitives géodésiques (distance, longueur, cap, rayon
  de courbure) avec un seuil de couverture de 80 %.
- Garde-fou `scripts/check-clean.sh` branché sur le hook `pre-push`.
- Intégration continue GitHub Actions : `lint`, `typecheck`, `test`, `build`,
  `shellcheck` et `check-clean` sur chaque PR, avec cache pnpm.
- `apps/server` : API Fastify, configuration validée par Zod, SQLite en mode
  WAL avec migrations Kysely, en-têtes de sécurité, limitation de débit,
  corps de requête bornés, logs JSON pino, et `GET /api/health` (version,
  commit, état de la base et des données).
- `deploy.sh` : déploiement en une commande, idempotent, avec releases
  atomiques, sauvegarde SQLite avant migration, unité systemd durcie, vhost
  Nginx dédié vérifié par `nginx -t`, certificat Let's Encrypt, contrôle
  ufw, healthcheck et rollback automatique ; options `--skip-ssl`,
  `--skip-data`, `--rollback`, `--status`.
- Test de bout en bout du déploiement dans Ubuntu 24.04 + systemd (job CI
  `deploy-test`) et guide `docs/DEPLOIEMENT.md`.
- `apps/web` : application Vite + Svelte 5, page « bientôt disponible »
  avec catalogue de traductions typé, thèmes clair et sombre.

### Corrigé

- Le hook `pre-commit` n'échoue plus quand aucun fichier n'est indexé.

[Non publié]: https://github.com/gabinlsc/trains/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/gabinlsc/trains/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/gabinlsc/trains/releases/tag/v0.1.0
