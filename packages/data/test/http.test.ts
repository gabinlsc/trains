import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChecksumMismatchError,
  download,
  mapConcurrent,
  SourceUnavailableError,
  type FetchLike,
} from '../src/http.ts';

const URL = 'https://exemple.test/source.json';
const BODY = '{"ok":true}';
const SHA = createHash('sha256').update(BODY).digest('hex');
const noWait = () => 0;

/** Simule une suite de réponses ; une Error dans la liste est levée (erreur réseau). */
function scripted(responses: (Response | Error)[]): FetchLike & { calls: number } {
  const fn = Object.assign(
    () => {
      const next = responses[Math.min(fn.calls, responses.length - 1)];
      fn.calls++;
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve((next as Response).clone());
    },
    { calls: 0 },
  );
  return fn;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'trains-http-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('download', () => {
  it('télécharge, calcule l’empreinte et écrit un cache réutilisable', async () => {
    const fetchImpl = scripted([new Response(BODY)]);
    const dest = join(dir, 'a', 'source.json');
    const first = await download(URL, dest, { sourceId: 's', fetchImpl });
    expect(first).toMatchObject({ sha256: SHA, bytes: BODY.length, url: URL });
    expect(await readFile(dest, 'utf8')).toBe(BODY);

    const second = await download(URL, dest, { sourceId: 's', fetchImpl });
    expect(fetchImpl.calls).toBe(1);
    expect(second.sha256).toBe(SHA);
  });

  it('retélécharge une copie en cache corrompue', async () => {
    const fetchImpl = scripted([new Response(BODY)]);
    const dest = join(dir, 'source.json');
    await download(URL, dest, { sourceId: 's', fetchImpl });
    await writeFile(dest, '{"ok":fals}');
    await download(URL, dest, { sourceId: 's', fetchImpl });
    expect(fetchImpl.calls).toBe(2);
    expect(await readFile(dest, 'utf8')).toBe(BODY);
  });

  it('retente après une erreur réseau puis un 503', async () => {
    const fetchImpl = scripted([
      new TypeError('fetch failed'),
      new Response('indisponible', { status: 503 }),
      new Response(BODY),
    ]);
    const log = vi.fn();
    const result = await download(URL, join(dir, 'x.json'), {
      sourceId: 's',
      fetchImpl,
      backoffMs: noWait,
      log,
    });
    expect(result.sha256).toBe(SHA);
    expect(fetchImpl.calls).toBe(3);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('abandonne sans insister sur une erreur définitive', async () => {
    const fetchImpl = scripted([new Response('absent', { status: 404 })]);
    await expect(
      download(URL, join(dir, 'x.json'), { sourceId: 'gares', fetchImpl, backoffMs: noWait }),
    ).rejects.toThrow(/Source « gares » indisponible .* HTTP 404/);
    expect(fetchImpl.calls).toBe(1);
  });

  it('retente les codes déclarés par la source', async () => {
    const fetchImpl = scripted([new Response('surcharge', { status: 400 }), new Response(BODY)]);
    const result = await download(URL, join(dir, 'x.json'), {
      sourceId: 'cours-eau',
      fetchImpl,
      backoffMs: noWait,
      retryStatuses: [400],
    });
    expect(result.sha256).toBe(SHA);
    expect(fetchImpl.calls).toBe(2);
  });

  it('échoue clairement après épuisement des tentatives', async () => {
    const fetchImpl = scripted([new TypeError('fetch failed')]);
    const error = await download(URL, join(dir, 'x.json'), {
      sourceId: 'communes',
      fetchImpl,
      retries: 2,
      backoffMs: noWait,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceUnavailableError);
    expect((error as Error).message).toMatch(/fetch failed \(3 tentatives\)/);
    expect(fetchImpl.calls).toBe(3);
  });

  it('détecte un transfert tronqué et le retente', async () => {
    const fetchImpl = scripted([
      new Response(BODY, { headers: { 'content-length': '999' } }),
      new Response(BODY),
    ]);
    await download(URL, join(dir, 'x.json'), { sourceId: 's', fetchImpl, backoffMs: noWait });
    expect(fetchImpl.calls).toBe(2);
  });

  it('vérifie l’empreinte attendue, y compris sur le cache', async () => {
    const dest = join(dir, 'x.json');
    await expect(
      download(URL, dest, {
        sourceId: 's',
        sha256: 'a'.repeat(64),
        fetchImpl: scripted([new Response(BODY)]),
      }),
    ).rejects.toBeInstanceOf(ChecksumMismatchError);

    await download(URL, dest, {
      sourceId: 's',
      sha256: SHA,
      fetchImpl: scripted([new Response(BODY)]),
    });
    await expect(
      download(URL, dest, { sourceId: 's', sha256: 'b'.repeat(64), fetchImpl: scripted([]) }),
    ).rejects.toBeInstanceOf(ChecksumMismatchError);
  });

  it('retente une réponse sans corps', async () => {
    const empty = new Response(null);
    const fetchImpl = scripted([empty, new Response(BODY)]);
    await download(URL, join(dir, 'x.json'), { sourceId: 's', fetchImpl, backoffMs: noWait });
    expect(fetchImpl.calls).toBe(2);
  });
});

describe('mapConcurrent', () => {
  it('respecte la limite de concurrence et l’ordre des résultats', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapConcurrent([1, 2, 3, 4, 5], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
});
