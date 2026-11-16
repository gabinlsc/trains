import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataManifest, ManifestOutput, ManifestSource } from '@trains/shared';
import { download, mapConcurrent, type Downloaded, type FetchLike } from './http.ts';
import type { SourceDefinition } from './sources.ts';

export interface StepIO {
  /** Télécharge (ou reprend du cache) une source et la décode en JSON. */
  json(source: SourceDefinition): Promise<unknown>;
  /** Télécharge une source binaire et renvoie le fichier local. */
  file(source: SourceDefinition, extension: string): Promise<Downloaded>;
  /** Plusieurs fichiers agrégés sous une même source (ex. tuiles). */
  files(
    source: SourceDefinition,
    urls: readonly string[],
    extension: string,
    concurrency?: number,
  ): Promise<Downloaded[]>;
  /** Écrit un fichier de sortie et l'inscrit au manifeste. */
  write(name: string, content: string | Uint8Array, count: number): Promise<void>;
  log(message: string): void;
}

export interface Step {
  id: string;
  run(io: StepIO): Promise<void>;
}

export interface PipelineOptions {
  dataVersion: string;
  outDir: string;
  cacheDir: string;
  steps: readonly Step[];
  fetchImpl?: FetchLike;
  log?: (message: string) => void;
  /** Pause entre deux tentatives ; réduite à zéro dans les tests. */
  backoffMs?: (attempt: number) => number;
}

function cacheName(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

/** Exécute les étapes dans `outDir` et y écrit manifest.json. */
export async function runPipeline(options: PipelineOptions): Promise<DataManifest> {
  const { outDir, cacheDir, fetchImpl, backoffMs, log = () => undefined } = options;
  const sources = new Map<string, ManifestSource>();
  const outputs: ManifestOutput[] = [];
  await mkdir(outDir, { recursive: true });

  function record(source: SourceDefinition, results: readonly Downloaded[]): void {
    const first = results[0];
    if (!first) return;
    // Plusieurs fichiers : l'empreinte agrège celles de chaque fichier, dans l'ordre.
    const sha256 =
      results.length === 1
        ? first.sha256
        : createHash('sha256')
            .update(results.map((r) => r.sha256).join('\n'))
            .digest('hex');
    sources.set(source.id, {
      id: source.id,
      title: source.title,
      producer: source.producer,
      license: source.license,
      url: source.url,
      retrievedAt: results.map((r) => r.retrievedAt).sort()[0] ?? first.retrievedAt,
      sha256,
      bytes: results.reduce((sum, r) => sum + r.bytes, 0),
      files: results.length,
    });
  }

  const fetchOne = (source: SourceDefinition, url: string, extension: string) =>
    download(url, join(cacheDir, source.id, `${cacheName(url)}.${extension}`), {
      sourceId: source.id,
      ...(source.sha256 && url === source.url ? { sha256: source.sha256 } : {}),
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(backoffMs ? { backoffMs } : {}),
      log,
    });

  const io: StepIO = {
    async json(source) {
      const result = await fetchOne(source, source.url, 'json');
      record(source, [result]);
      try {
        return JSON.parse(await readFile(result.path, 'utf8')) as unknown;
      } catch (error) {
        throw new Error(`Source « ${source.id} » : JSON invalide (${source.url})`, {
          cause: error,
        });
      }
    },
    async file(source, extension) {
      const result = await fetchOne(source, source.url, extension);
      record(source, [result]);
      return result;
    },
    async files(source, urls, extension, concurrency = 8) {
      const results = await mapConcurrent(urls, concurrency, (url) =>
        fetchOne(source, url, extension),
      );
      record(source, results);
      return results;
    },
    async write(name, content, count) {
      const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
      await writeFile(join(outDir, name), data);
      outputs.push({
        file: name,
        sha256: createHash('sha256').update(data).digest('hex'),
        bytes: data.byteLength,
        count,
      });
    },
    log,
  };

  for (const step of options.steps) {
    const started = Date.now();
    log(`▶ ${step.id}`);
    await step.run(io);
    log(`  ${step.id} terminé en ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }

  const manifest: DataManifest = {
    dataVersion: options.dataVersion,
    generatedAt: new Date().toISOString(),
    sources: [...sources.values()].sort((a, b) => a.id.localeCompare(b.id)),
    outputs: outputs.sort((a, b) => a.file.localeCompare(b.file)),
  };
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
