// Point d'entrée : `pnpm --filter @trains/data run pipeline [--force]`.
// DATA_DIR désigne la racine des données (défaut : ./.local/data).
import { resolve } from 'node:path';
import { generate } from './publish.ts';
import { STEPS } from './steps/index.ts';
import { DATA_VERSION } from './version.ts';

const args = new Set(process.argv.slice(2));
if (args.has('--help')) {
  process.stdout.write('Usage : pipeline [--force]\n  DATA_DIR=<racine des données>\n');
  process.exit(0);
}

const dataDir = resolve(process.env.DATA_DIR ?? './.local/data');
const log = (message: string): void => {
  process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${message}\n`);
};

try {
  log(`Pipeline de données ${DATA_VERSION} → ${dataDir}`);
  const result = await generate({
    dataDir,
    dataVersion: DATA_VERSION,
    steps: STEPS,
    force: args.has('--force'),
    log,
  });
  log(result.status === 'generated' ? 'Terminé.' : 'Rien à faire.');
} catch (error) {
  // Message lisible pour l'opérateur ; la pile reste disponible pour le diagnostic.
  process.stderr.write(`\n✖ ${error instanceof Error ? error.message : String(error)}\n`);
  if (error instanceof Error && error.cause instanceof Error) {
    process.stderr.write(`  cause : ${error.cause.message}\n`);
  }
  process.exitCode = 1;
}
