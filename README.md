# Rails de France

Jeu de construction de réseaux ferroviaires sur la carte réelle de la France.
Le joueur trace des voies, place des gares, crée des lignes commerciales, et
le jeu calcule instantanément les conséquences : coût, temps de parcours,
fréquentation, rentabilité, impact carbone.

Production : <https://trains.glsc.fr>

## Prérequis

- Node.js 22 LTS (voir `.nvmrc`)
- pnpm via corepack : `corepack enable`
- Pour les scripts shell : `shellcheck` (facultatif en local, obligatoire en CI)

## Démarrage

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm check        # format, lint, typage, tests, garde-fou
```

## Organisation du dépôt

| Chemin            | Rôle                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| `apps/web`        | Front (Vite, TypeScript, MapLibre GL JS)                               |
| `apps/server`     | API Fastify, WebSocket, images Open Graph                              |
| `packages/engine` | Moteur de calcul pur et déterministe, partagé client/serveur           |
| `packages/shared` | Types, schémas Zod, constantes, catalogues                             |
| `packages/data`   | Pipeline de données ouvertes (téléchargement, nettoyage, génération)   |
| `scripts/`        | Utilitaires de développement, dont le garde-fou `check-clean.sh`       |
| `deploy/`         | Modèles Nginx et systemd utilisés par `deploy.sh`                      |
| `docs/`           | Architecture, décisions (ADR), données, modèle économique, déploiement |

## Scripts utiles

| Commande           | Effet                                                 |
| ------------------ | ----------------------------------------------------- |
| `pnpm dev`         | Lance les applications en mode développement          |
| `pnpm build`       | Construit toutes les applications                     |
| `pnpm lint`        | ESLint, zéro avertissement toléré                     |
| `pnpm typecheck`   | Vérification TypeScript stricte de chaque paquet      |
| `pnpm test`        | Tests Vitest (couverture ≥ 80 % exigée sur le moteur) |
| `pnpm format`      | Formatage Prettier                                    |
| `pnpm check:clean` | Garde-fou sur l'historique et le contenu du dépôt     |

## Contribuer

Le flux est strict : branche `feature/<sujet>` depuis `main`, commits au
format [Conventional Commits](https://www.conventionalcommits.org/fr/)
rédigés en français, puis pull request fusionnée en _squash_ une fois la CI
verte. `main` reste déployable en permanence.

Les hooks Git (installés automatiquement par `pnpm install`) vérifient le
formatage avant chaque commit et lancent `scripts/check-clean.sh` avant
chaque push.

Les choix d'architecture sont consignés dans [`docs/DECISIONS.md`](docs/DECISIONS.md).
