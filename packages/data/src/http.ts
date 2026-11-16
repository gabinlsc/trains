import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { z } from 'zod';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Source injoignable ou réponse inexploitable : message destiné à l'opérateur. */
export class SourceUnavailableError extends Error {
  constructor(
    readonly sourceId: string,
    readonly url: string,
    reason: string,
    options?: ErrorOptions,
  ) {
    super(`Source « ${sourceId} » indisponible (${url}) : ${reason}`, options);
    this.name = 'SourceUnavailableError';
  }
}

export class ChecksumMismatchError extends Error {
  constructor(sourceId: string, url: string, expected: string, actual: string) {
    super(
      `Empreinte inattendue pour « ${sourceId} » (${url}) : attendu ${expected}, obtenu ${actual}. ` +
        'Le fichier amont a changé : vérifier la source puis mettre à jour sources.ts.',
    );
    this.name = 'ChecksumMismatchError';
  }
}

export interface DownloadOptions {
  sourceId: string;
  /** Empreinte attendue, pour les fichiers amont immuables. */
  sha256?: string;
  retries?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  /** Pause avant la tentative n (1-indexée), en ms ; injectable pour les tests. */
  backoffMs?: (attempt: number) => number;
  log?: (message: string) => void;
}

export interface Downloaded {
  path: string;
  url: string;
  sha256: string;
  bytes: number;
  retrievedAt: string;
}

const CacheMetaSchema = z.object({
  url: z.string(),
  sha256: z.string(),
  bytes: z.number(),
  retrievedAt: z.string(),
});

const USER_AGENT = 'rails-de-france-data-pipeline/1.0';

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

/**
 * Télécharge `url` vers `dest`, sauf si une copie intègre est déjà en cache
 * (même URL, empreinte vérifiée). Le fichier est écrit à côté puis renommé :
 * une interruption ne laisse jamais de fichier tronqué sous le nom final.
 */
export async function download(
  url: string,
  dest: string,
  options: DownloadOptions,
): Promise<Downloaded> {
  const {
    sourceId,
    retries = 4,
    timeoutMs = 120_000,
    fetchImpl = fetch,
    backoffMs = (attempt) => 1000 * 2 ** (attempt - 1),
    log = () => undefined,
  } = options;
  const metaPath = `${dest}.meta.json`;

  const cached = await readCache(dest, metaPath, url);
  if (cached) {
    if (options.sha256 && cached.sha256 !== options.sha256) {
      throw new ChecksumMismatchError(sourceId, url, options.sha256, cached.sha256);
    }
    return cached;
  }

  await mkdir(dirname(dest), { recursive: true });
  const partial = `${dest}.part`;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    if (attempt > 1) {
      const wait = backoffMs(attempt - 1);
      log(`  nouvelle tentative ${attempt - 1}/${retries} pour ${sourceId} dans ${wait} ms`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    const outcome = await attemptDownload(url, partial, options, fetchImpl, timeoutMs);
    if ('retry' in outcome) {
      lastError = outcome.retry;
      continue;
    }
    if (options.sha256 && outcome.sha256 !== options.sha256) {
      await rm(partial, { force: true });
      throw new ChecksumMismatchError(sourceId, url, options.sha256, outcome.sha256);
    }
    await rename(partial, dest);
    const result: Downloaded = {
      path: dest,
      url,
      ...outcome,
      retrievedAt: new Date().toISOString(),
    };
    const { path: _path, ...meta } = result;
    await writeFile(metaPath, JSON.stringify(meta));
    return result;
  }

  await rm(partial, { force: true });
  throw new SourceUnavailableError(
    sourceId,
    url,
    `${lastError?.message ?? 'échec'} (${retries + 1} tentatives)`,
    { cause: lastError },
  );
}

/**
 * Une tentative. Renvoie `{ retry }` pour une erreur passagère (réseau,
 * délai, 5xx, 429, transfert tronqué) et lève pour une erreur définitive
 * (404, 403…), qu'il est inutile de retenter.
 */
async function attemptDownload(
  url: string,
  partial: string,
  options: DownloadOptions,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<{ sha256: string; bytes: number } | { retry: Error }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
    });
  } catch (error) {
    return { retry: error instanceof Error ? error : new Error(String(error)) };
  }
  if (!response.ok) {
    const error = new SourceUnavailableError(options.sourceId, url, `HTTP ${response.status}`);
    if (isRetryableStatus(response.status)) return { retry: error };
    throw error;
  }
  if (!response.body) return { retry: new Error('réponse sans contenu') };

  const hash = createHash('sha256');
  let bytes = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
      tap,
      createWriteStream(partial),
    );
  } catch (error) {
    return { retry: error instanceof Error ? error : new Error(String(error)) };
  }

  // Content-Length décrit le corps compressé si Content-Encoding est présent.
  const expected = Number(response.headers.get('content-length'));
  if (expected > 0 && !response.headers.get('content-encoding') && expected !== bytes) {
    return { retry: new Error(`transfert tronqué (${bytes}/${expected} octets)`) };
  }
  return { sha256: hash.digest('hex'), bytes };
}

async function readCache(dest: string, metaPath: string, url: string): Promise<Downloaded | null> {
  try {
    const meta = CacheMetaSchema.parse(JSON.parse(await readFile(metaPath, 'utf8')));
    if (meta.url !== url) return null;
    const info = await stat(dest);
    if (info.size !== meta.bytes) return null;
    // Une copie corrompue (disque plein, édition manuelle) est retéléchargée.
    if ((await sha256File(dest)) !== meta.sha256) return null;
    return { ...meta, path: dest };
  } catch {
    return null;
  }
}

/** Exécute `task` sur chaque élément avec au plus `limit` opérations simultanées. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}
