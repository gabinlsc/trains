// Point d'entrée : `pnpm --filter @trains/data run basemap [--force]`.
// Met à jour DATA_DIR/tiles/ (fond de carte PMTiles, glyphes, sprites).
import { resolve } from 'node:path';
import { updateBasemap } from './basemap/command.ts';

const args = new Set(process.argv.slice(2));
const dataDir = resolve(process.env.DATA_DIR ?? './.local/data');
const log = (message: string): void => {
  process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${message}\n`);
};

try {
  log(`Fond de carte → ${dataDir}/tiles`);
  await updateBasemap({ dataDir, force: args.has('--force'), log });
} catch (error) {
  process.stderr.write(`\n✖ ${error instanceof Error ? error.message : String(error)}\n`);
  if (error instanceof Error && error.cause instanceof Error) {
    process.stderr.write(`  cause : ${error.cause.message}\n`);
  }
  process.exitCode = 1;
}
