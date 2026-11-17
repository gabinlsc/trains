import { afterEach, describe, expect, it } from 'vitest';
import { loadDataFile, loadManifest, resetManifestCache, tableToPoints } from './data.ts';

afterEach(() => {
  resetManifestCache();
});

function fakeFetch(routes: Record<string, unknown>): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = (input: string) => {
    const url = input;
    calls.push(url);
    const body = routes[url];
    return Promise.resolve(
      body === undefined
        ? new Response('absent', { status: 404 })
        : new Response(JSON.stringify(body)),
    );
  };
  return Object.assign(impl as unknown as typeof fetch, { calls });
}

const MANIFEST = { dataVersion: '2026.11.1', outputs: [{ file: 'gares.json' }] };

describe('données publiées', () => {
  it('lit les fichiers sous la version du manifeste, et le manifeste une seule fois', async () => {
    const fetchImpl = fakeFetch({
      '/data/current/manifest.json': MANIFEST,
      '/data/2026.11.1/gares.json': { fields: [], rows: [] },
    });
    await loadDataFile('gares.json', fetchImpl);
    await loadDataFile('gares.json', fetchImpl);
    expect(fetchImpl.calls).toEqual([
      '/data/current/manifest.json',
      '/data/2026.11.1/gares.json',
      '/data/2026.11.1/gares.json',
    ]);
  });

  it('refuse un fichier absent de la génération', async () => {
    const fetchImpl = fakeFetch({ '/data/current/manifest.json': MANIFEST });
    await expect(loadDataFile('communes.json', fetchImpl)).rejects.toThrow(
      /absent de la génération 2026.11.1/,
    );
  });

  it('signale un fichier inaccessible', async () => {
    const fetchImpl = fakeFetch({ '/data/current/manifest.json': MANIFEST });
    await expect(loadDataFile('gares.json', fetchImpl)).rejects.toThrow(/HTTP 404/);
  });

  it('retente le manifeste après un échec', async () => {
    await expect(loadManifest(fakeFetch({}))).rejects.toThrow(/HTTP 404/);
    const manifest = await loadManifest(fakeFetch({ '/data/current/manifest.json': MANIFEST }));
    expect(manifest.dataVersion).toBe('2026.11.1');
  });

  it('rejette un manifeste invalide', async () => {
    await expect(
      loadManifest(fakeFetch({ '/data/current/manifest.json': { outputs: [] } })),
    ).rejects.toThrow(/manifeste invalide/);
  });
});

describe('tableToPoints', () => {
  const table = {
    fields: ['code', 'nom', 'population', 'lng', 'lat'],
    rows: [
      ['75056', 'Paris', 2_103_778, 2.347, 48.8589],
      ['55039', 'Beaumont-en-Verdunois', 0, 5.42, 49.27],
    ],
  };

  it('convertit les lignes en points avec leurs propriétés', () => {
    const result = tableToPoints(table);
    expect(result.features[0]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [2.347, 48.8589] },
      properties: { code: '75056', nom: 'Paris', population: 2_103_778 },
    });
  });

  it('filtre selon les propriétés', () => {
    expect(tableToPoints(table, (p) => (p.population as number) >= 2000).features).toHaveLength(1);
  });

  it('exige les colonnes de position', () => {
    expect(() => tableToPoints({ fields: ['nom'], rows: [] })).toThrow(/lng\/lat/);
  });
});
