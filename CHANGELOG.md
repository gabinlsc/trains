# Journal des modifications

Toutes les évolutions notables de ce projet sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et
le projet adhère au [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

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

[Non publié]: https://github.com/gabinlsc/trains/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gabinlsc/trains/releases/tag/v0.1.0
