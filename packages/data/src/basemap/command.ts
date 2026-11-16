import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_BBOX } from '@trains/shared';
import { z } from 'zod';
import { download, mapConcurrent, type FetchLike } from '../http.ts';
import { extractRegion, httpRangeReader, type RangeReader } from './extract.ts';

export const BUILDS_URL = 'https://build-metadata.protomaps.dev/builds.json';
export const BUILD_BASE_URL = 'https://build.protomaps.com';
export const ASSETS_BASE_URL = 'https://protomaps.github.io/basemaps-assets';

/** Version majeure du schéma de tuiles compatible avec le style de l'application. */
export const SCHEMA_MAJOR = 4;
/** Zoom maximal extrait : au-delà, la taille explose pour un gain nul à l'échelle du jeu. */
export const MAX_ZOOM = 13;
/** Âge au-delà duquel l'extrait est rafraîchi (bâtiments, routes, noms). */
export const MAX_AGE_DAYS = 90;
export const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'] as const;
export const SPRITES = ['light', 'light@2x', 'dark', 'dark@2x'] as const;

const BuildsSchema = z.array(
  z
    .object({ key: z.string().regex(/^\d{8}\.pmtiles$/), version: z.string(), size: z.number() })
    .loose(),
);

const StateSchema = z.object({
  build: z.string(),
  version: z.string(),
  extractedAt: z.iso.datetime(),
  maxZoom: z.number().int(),
  bbox: z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() }),
  sha256: z.string(),
  bytes: z.number().int(),
  tiles: z.number().int(),
});
export type BasemapState = z.infer<typeof StateSchema>;

export function majorOf(version: string): number {
  return Number(version.split('.')[0]);
}

/** Dernier build publié dont le schéma est compatible. */
export function pickBuild(raw: unknown): { key: string; version: string } {
  const compatible = BuildsSchema.parse(raw)
    .filter((b) => majorOf(b.version) === SCHEMA_MAJOR)
    .sort((a, b) => a.key.localeCompare(b.key));
  const latest = compatible[compatible.length - 1];
  if (!latest)
    throw new Error(`Aucun build Protomaps au schéma v${SCHEMA_MAJOR} dans ${BUILDS_URL}`);
  return { key: latest.key, version: latest.version };
}

/** Faut-il (ré)extraire ? Renvoie la raison, ou null si l'extrait en place convient. */
export function staleReason(
  state: BasemapState | null,
  now: Date,
  fileExists: boolean,
): string | null {
  if (!state || !fileExists) return 'extrait absent';
  if (majorOf(state.version) !== SCHEMA_MAJOR) return `schéma ${state.version} incompatible`;
  if (state.maxZoom !== MAX_ZOOM) return `zoom ${state.maxZoom} au lieu de ${MAX_ZOOM}`;
  const bbox = state.bbox;
  if (
    bbox.west !== DATA_BBOX.west ||
    bbox.south !== DATA_BBOX.south ||
    bbox.east !== DATA_BBOX.east ||
    bbox.north !== DATA_BBOX.north
  ) {
    return 'emprise modifiée';
  }
  const age = (now.getTime() - new Date(state.extractedAt).getTime()) / 86_400_000;
  if (age > MAX_AGE_DAYS) return `extrait de ${Math.floor(age)} jours`;
  return null;
}

/** Les 256 plages de glyphes (0-255 … 65280-65535) attendues par MapLibre. */
export function glyphRanges(): string[] {
  return Array.from({ length: 256 }, (_, i) => `${i * 256}-${i * 256 + 255}`);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface BasemapOptions {
  dataDir: string;
  force?: boolean;
  now?: Date;
  fetchImpl?: FetchLike;
  /** Lecteur de l'archive mondiale ; injectable pour les tests. */
  readerFor?: (url: string) => RangeReader;
  backoffMs?: (attempt: number) => number;
  log?: (message: string) => void;
}

/**
 * Met à jour DATA_DIR/tiles/ : france.pmtiles (fond de carte), france.json
 * (état de l'extrait) et assets/ (glyphes et sprites, servis tels quels).
 */
export async function updateBasemap(options: BasemapOptions): Promise<'up-to-date' | 'extracted'> {
  const {
    dataDir,
    force = false,
    now = new Date(),
    fetchImpl,
    backoffMs,
    log = () => undefined,
  } = options;
  const tilesDir = join(dataDir, 'tiles');
  const archive = join(tilesDir, 'france.pmtiles');
  const statePath = join(tilesDir, 'france.json');
  await mkdir(tilesDir, { recursive: true });

  await updateAssets(tilesDir, { fetchImpl, backoffMs, log });

  let state: BasemapState | null = null;
  try {
    state = StateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')));
  } catch {
    state = null;
  }
  const exists = await stat(archive).then(
    () => true,
    () => false,
  );
  const reason = force ? 'régénération demandée' : staleReason(state, now, exists);
  if (!reason) {
    log(`Fond de carte à jour (${state?.build ?? '?'}, schéma ${state?.version ?? '?'}).`);
    return 'up-to-date';
  }

  log(`Fond de carte : ${reason}, extraction en cours.`);
  const buildsFile = join(dataDir, 'cache', 'basemap', 'builds.json');
  await rm(buildsFile, { force: true });
  await rm(`${buildsFile}.meta.json`, { force: true });
  const builds = await download(BUILDS_URL, buildsFile, {
    sourceId: 'protomaps-builds',
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(backoffMs ? { backoffMs } : {}),
    log,
  });
  const build = pickBuild(JSON.parse(await readFile(builds.path, 'utf8')));
  const url = `${BUILD_BASE_URL}/${build.key}`;
  log(`  build ${build.key} (schéma ${build.version})`);

  const reader =
    options.readerFor?.(url) ?? httpRangeReader(url, { ...(fetchImpl ? { fetchImpl } : {}) });
  const result = await extractRegion(reader, {
    bbox: DATA_BBOX,
    maxZoom: MAX_ZOOM,
    outPath: archive,
    log,
  });
  const next: BasemapState = {
    build: build.key,
    version: build.version,
    extractedAt: now.toISOString(),
    maxZoom: MAX_ZOOM,
    bbox: { ...DATA_BBOX },
    sha256: await sha256File(archive),
    bytes: result.bytes,
    tiles: result.tiles,
  };
  await writeFile(`${statePath}.tmp`, `${JSON.stringify(next, null, 2)}\n`);
  await rename(`${statePath}.tmp`, statePath);
  log(`Fond de carte extrait : ${result.tiles} tuiles, ${(result.bytes / 1e9).toFixed(2)} Go.`);
  return 'extracted';
}

/** Glyphes et sprites : téléchargés une fois, revérifiés par le cache à chaque passage. */
async function updateAssets(
  tilesDir: string,
  options: Pick<BasemapOptions, 'fetchImpl' | 'backoffMs' | 'log'>,
): Promise<void> {
  const jobs: { url: string; dest: string }[] = [];
  for (const font of FONTS) {
    for (const range of glyphRanges()) {
      jobs.push({
        url: `${ASSETS_BASE_URL}/fonts/${encodeURIComponent(font)}/${range}.pbf`,
        dest: join(tilesDir, 'assets', 'fonts', font, `${range}.pbf`),
      });
    }
  }
  for (const sprite of SPRITES) {
    for (const ext of ['json', 'png']) {
      jobs.push({
        url: `${ASSETS_BASE_URL}/sprites/v4/${sprite}.${ext}`,
        dest: join(tilesDir, 'assets', 'sprites', 'v4', `${sprite}.${ext}`),
      });
    }
  }
  await mapConcurrent(jobs, 16, ({ url, dest }) =>
    download(url, dest, {
      sourceId: 'protomaps-assets',
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.backoffMs ? { backoffMs: options.backoffMs } : {}),
      ...(options.log ? { log: options.log } : {}),
    }),
  );
  options.log?.(`  ${jobs.length} glyphes et sprites en place`);
}
