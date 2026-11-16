# Journal des modifications

Toutes les évolutions notables de ce projet sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et
le projet adhère au [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté

- Monorepo pnpm (`apps/*`, `packages/*`), TypeScript strict, ESLint, Prettier, Vitest.
- `packages/shared` : caractéristiques de voie (nombre de voies, écartement,
  électrification, signalisation, vitesse de conception) validées par Zod.
- `packages/engine` : primitives géodésiques (distance, longueur, cap, rayon
  de courbure) avec un seuil de couverture de 80 %.
- Garde-fou `scripts/check-clean.sh` branché sur le hook `pre-push`.
- Intégration continue GitHub Actions : `lint`, `typecheck`, `test`, `build`,
  `shellcheck` et `check-clean` sur chaque PR, avec cache pnpm.
