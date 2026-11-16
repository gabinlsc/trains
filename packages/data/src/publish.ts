import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { DataManifestSchema } from '@trains/shared';
import { runPipeline, type PipelineOptions } from './pipeline.ts';

export interface GenerateOptions extends Omit<PipelineOptions, 'outDir' | 'cacheDir'> {
  /** Racine des données (DATA_DIR) : sorties dans DATA_DIR/data/<version>/. */
  dataDir: string;
  force?: boolean;
  /** Générations conservées en plus de la courante, pour revenir en arrière. */
  keepPrevious?: number;
}

export interface GenerateResult {
  status: 'up-to-date' | 'generated';
  dir: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isComplete(dir: string, version: string): Promise<boolean> {
  try {
    const manifest = DataManifestSchema.parse(
      JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')),
    );
    return manifest.dataVersion === version;
  } catch {
    return false;
  }
}

/** Fait pointer `current` sur `target` par renommage atomique d'un lien temporaire. */
async function pointCurrent(root: string, version: string): Promise<void> {
  const temp = join(root, `.current-${process.pid}`);
  await rm(temp, { force: true });
  await symlink(version, temp);
  await rename(temp, join(root, 'current'));
}

/**
 * Un seul pipeline à la fois : deux déploiements simultanés écriraient dans
 * le même dossier de travail. Un verrou orphelin (processus disparu) est repris.
 */
async function acquireLock(root: string): Promise<() => Promise<void>> {
  const path = join(root, '.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      return () => unlink(path).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number((await readFile(path, 'utf8').catch(() => '')).trim());
      let alive = false;
      if (pid > 0) {
        try {
          process.kill(pid, 0);
          alive = true;
        } catch {
          alive = false;
        }
      }
      if (alive) throw new Error(`Pipeline déjà en cours (pid ${pid}, verrou ${path}).`);
      await rm(path, { force: true });
    }
  }
  throw new Error(`Verrou ${path} impossible à acquérir.`);
}

/**
 * Génère DATA_DIR/data/<version>/ si nécessaire, dans un dossier de travail
 * renommé à la fin : une génération interrompue ne publie jamais de données
 * partielles. Le cache des téléchargements survit à un échec, ce qui rend la
 * relance rapide.
 */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const { dataDir, dataVersion, force = false, keepPrevious = 1, log = () => undefined } = options;
  const root = join(dataDir, 'data');
  const target = join(root, dataVersion);
  await mkdir(root, { recursive: true });

  const release = await acquireLock(root);
  try {
    if (!force && (await isComplete(target, dataVersion))) {
      await pointCurrent(root, dataVersion);
      log(`Données ${dataVersion} déjà générées.`);
      return { status: 'up-to-date', dir: target };
    }

    const work = join(root, `.build-${dataVersion}`);
    await rm(work, { recursive: true, force: true });
    await runPipeline({
      ...options,
      outDir: work,
      cacheDir: join(dataDir, 'cache', dataVersion),
      log,
    });
    if (await exists(target)) await rm(target, { recursive: true, force: true });
    await rename(work, target);
    await pointCurrent(root, dataVersion);
    await prune(dataDir, root, dataVersion, keepPrevious);
    log(`Données ${dataVersion} publiées dans ${target}.`);
    return { status: 'generated', dir: target };
  } finally {
    await release();
  }
}

/** Supprime les générations et caches anciens, en gardant `keep` versions précédentes. */
async function prune(dataDir: string, root: string, current: string, keep: number): Promise<void> {
  const versions: string[] = [];
  for (const entry of await readdir(root)) {
    if (!/^\d{4}\.\d{2}\.\d+$/.test(entry)) continue;
    if ((await lstat(join(root, entry))).isDirectory()) versions.push(entry);
  }
  const byAge = versions
    .filter((v) => v !== current)
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  for (const old of byAge.slice(keep)) await rm(join(root, old), { recursive: true, force: true });

  // Le cache n'est utile qu'à la version en cours de génération.
  const cacheRoot = join(dataDir, 'cache');
  for (const entry of await readdir(cacheRoot).catch(() => [] as string[])) {
    if (entry !== current) await rm(join(cacheRoot, entry), { recursive: true, force: true });
  }
}
