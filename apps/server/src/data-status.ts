import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Le pipeline de données publie chaque génération dans
 * DATA_DIR/data/<data-version>/ et fait pointer DATA_DIR/data/current dessus.
 * Seul le manifeste est lu ici : c'est lui qui atteste d'une génération complète.
 */
const ManifestSchema = z.object({ dataVersion: z.string().min(1) }).loose();

export type DataStatus =
  { status: 'ok'; version: string } | { status: 'missing' } | { status: 'invalid'; reason: string };

export async function readDataStatus(dataDir: string): Promise<DataStatus> {
  const manifestPath = join(dataDir, 'data', 'current', 'manifest.json');
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    return { status: 'invalid', reason: 'manifeste illisible' };
  }
  try {
    const manifest = ManifestSchema.parse(JSON.parse(raw));
    return { status: 'ok', version: manifest.dataVersion };
  } catch {
    return { status: 'invalid', reason: 'manifeste mal formé' };
  }
}
