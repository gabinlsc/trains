import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataManifestSchema } from '@trains/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/http.ts';
import type { Step } from '../src/pipeline.ts';
import { generate } from '../src/publish.ts';
import type { SourceDefinition } from '../src/sources.ts';

const SOURCE: SourceDefinition = {
  id: 'essai',
  title: 'Source d’essai',
  producer: 'Tests',
  license: 'Licence Ouverte 2.0',
  url: 'https://exemple.test/essai.json',
};

const step: Step = {
  id: 'essai',
  async run(io) {
    const data = (await io.json(SOURCE)) as number[];
    const tiles = await io.files(
      SOURCE,
      ['https://exemple.test/t1', 'https://exemple.test/t2'],
      'bin',
    );
    await io.write('sortie.json', JSON.stringify(data.map((n) => n * 2)), data.length);
    await io.write('tuiles.bin', new Uint8Array(tiles.length), tiles.length);
  },
};

const failing: Step = {
  id: 'en-echec',
  run: () => Promise.reject(new Error('source cassée')),
};

function fakeFetch(): FetchLike & { calls: number } {
  const fn = Object.assign(
    (url: string) => {
      fn.calls++;
      return Promise.resolve(new Response(url.endsWith('.json') ? '[1,2,3]' : 'tuile'));
    },
    { calls: 0 },
  );
  return fn;
}

let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'trains-data-'));
});
afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('generate', () => {
  it('publie une génération complète avec son manifeste et le lien current', async () => {
    const fetchImpl = fakeFetch();
    const result = await generate({ dataDir, dataVersion: '2026.11.1', steps: [step], fetchImpl });
    expect(result.status).toBe('generated');
    expect(await readlink(join(dataDir, 'data', 'current'))).toBe('2026.11.1');

    const manifest = DataManifestSchema.parse(
      JSON.parse(await readFile(join(dataDir, 'data', 'current', 'manifest.json'), 'utf8')),
    );
    expect(manifest.dataVersion).toBe('2026.11.1');
    expect(manifest.sources).toHaveLength(1);
    expect(manifest.sources[0]).toMatchObject({ id: 'essai', files: 2, bytes: 10 });
    expect(manifest.outputs.map((o) => [o.file, o.count])).toEqual([
      ['sortie.json', 3],
      ['tuiles.bin', 2],
    ]);
    expect(await readFile(join(dataDir, 'data', 'current', 'sortie.json'), 'utf8')).toBe('[2,4,6]');
  });

  it('ne régénère pas une version déjà publiée, sauf avec force', async () => {
    const fetchImpl = fakeFetch();
    await generate({ dataDir, dataVersion: '2026.11.1', steps: [step], fetchImpl });
    const calls = fetchImpl.calls;
    expect(
      (await generate({ dataDir, dataVersion: '2026.11.1', steps: [step], fetchImpl })).status,
    ).toBe('up-to-date');
    expect(fetchImpl.calls).toBe(calls);
    const forced = await generate({
      dataDir,
      dataVersion: '2026.11.1',
      steps: [step],
      fetchImpl,
      force: true,
    });
    expect(forced.status).toBe('generated');
  });

  it('ne publie rien et garde la version courante si une étape échoue', async () => {
    const fetchImpl = fakeFetch();
    await generate({ dataDir, dataVersion: '2026.11.1', steps: [step], fetchImpl });
    await expect(
      generate({ dataDir, dataVersion: '2026.11.2', steps: [step, failing], fetchImpl }),
    ).rejects.toThrow('source cassée');
    expect(await readlink(join(dataDir, 'data', 'current'))).toBe('2026.11.1');
    await expect(lstat(join(dataDir, 'data', '2026.11.2'))).rejects.toThrow();
    // Le verrou est libéré malgré l'échec.
    await expect(lstat(join(dataDir, 'data', '.lock'))).rejects.toThrow();
  });

  it('élague les anciennes versions et les caches périmés', async () => {
    const fetchImpl = fakeFetch();
    for (const version of ['2026.09.1', '2026.10.1', '2026.11.1']) {
      await generate({ dataDir, dataVersion: version, steps: [step], fetchImpl });
    }
    await expect(lstat(join(dataDir, 'data', '2026.09.1'))).rejects.toThrow();
    expect((await lstat(join(dataDir, 'data', '2026.10.1'))).isDirectory()).toBe(true);
    await expect(lstat(join(dataDir, 'cache', '2026.10.1'))).rejects.toThrow();
  });

  it('refuse de tourner en parallèle mais reprend un verrou orphelin', async () => {
    await mkdir(join(dataDir, 'data'), { recursive: true });
    await writeFile(join(dataDir, 'data', '.lock'), String(process.pid));
    await expect(
      generate({ dataDir, dataVersion: '2026.11.1', steps: [step], fetchImpl: fakeFetch() }),
    ).rejects.toThrow(/déjà en cours/);

    await writeFile(join(dataDir, 'data', '.lock'), '999999999');
    const result = await generate({
      dataDir,
      dataVersion: '2026.11.1',
      steps: [step],
      fetchImpl: fakeFetch(),
    });
    expect(result.status).toBe('generated');
  });

  it('signale un JSON amont invalide avec la source en cause', async () => {
    const broken: FetchLike = () => Promise.resolve(new Response('<html>maintenance</html>'));
    await expect(
      generate({ dataDir, dataVersion: '2026.11.1', steps: [step], fetchImpl: broken }),
    ).rejects.toThrow(/Source « essai » : JSON invalide/);
  });
});
