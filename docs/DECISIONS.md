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
