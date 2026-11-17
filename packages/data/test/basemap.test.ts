import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Compression, PMTiles, TileType, zxyToTileId, type Header } from 'pmtiles';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  glyphRanges,
  majorOf,
  MAX_AGE_DAYS,
  MAX_ZOOM,
  pickBuild,
  staleReason,
  updateBasemap,
  type BasemapState,
} from '../src/basemap/command.ts';
import {
  extractRegion,
  httpRangeReader,
  planRanges,
  type RangeReader,
} from '../src/basemap/extract.ts';
import {
  buildDirectories,
  deserializeDirectory,
  HEADER_BYTES,
  serializeDirectory,
  serializeHeader,
  tileBounds,
  tileIdsInBbox,
  type Entry,
} from '../src/basemap/format.ts';
import { DATA_BBOX } from '@trains/shared';

/** Archive PMTiles v3 complète, en mémoire, à partir de tuiles indexées par identifiant. */
function buildArchive(
  tiles: Map<number, Uint8Array>,
  maxZoom: number,
  rootBudget?: number,
): Uint8Array {
  const ids = [...tiles.keys()].sort((a, b) => a - b);
  const entries: Entry[] = [];
  const chunks: Uint8Array[] = [];
  const offsets = new Map<Uint8Array, number>();
  let cursor = 0;
  for (const id of ids) {
    const data = tiles.get(id) as Uint8Array;
    let offset = offsets.get(data);
    if (offset === undefined) {
      offset = cursor;
      offsets.set(data, offset);
      chunks.push(data);
      cursor += data.byteLength;
    }
    entries.push({ tileId: id, offset, length: data.byteLength, runLength: 1 });
  }
  const { root, leaves } = buildDirectories(entries, rootBudget);
  const metadata = gzipSync(Buffer.from(JSON.stringify({ version: '4.15.2', name: 'essai' })));
  const header: Header = {
    specVersion: 3,
    rootDirectoryOffset: HEADER_BYTES,
    rootDirectoryLength: root.byteLength,
    jsonMetadataOffset: HEADER_BYTES + root.byteLength,
    jsonMetadataLength: metadata.byteLength,
    leafDirectoryOffset: HEADER_BYTES + root.byteLength + metadata.byteLength,
    leafDirectoryLength: leaves.byteLength,
    tileDataOffset: HEADER_BYTES + root.byteLength + metadata.byteLength + leaves.byteLength,
    tileDataLength: cursor,
    numAddressedTiles: ids.length,
    numTileEntries: entries.length,
    numTileContents: chunks.length,
    clustered: true,
    internalCompression: Compression.Gzip,
    tileCompression: Compression.None,
    tileType: TileType.Mvt,
    minZoom: 0,
    maxZoom,
    minLon: -180,
    minLat: -85,
    maxLon: 180,
    maxLat: 85,
    centerZoom: 0,
    centerLon: 0,
    centerLat: 0,
  };
  const parts = [serializeHeader(header), root, metadata, leaves, ...chunks];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Lecteur en mémoire qui compte les requêtes ; complète avec des zéros au-delà de la fin. */
function memoryReader(bytes: Uint8Array): RangeReader & { requests: number } {
  const reader = {
    requests: 0,
    read(offset: number, length: number) {
      reader.requests++;
      const out = new Uint8Array(length);
      out.set(bytes.subarray(offset, Math.min(bytes.byteLength, offset + length)));
      return Promise.resolve(out);
    },
  };
  return reader;
}

/** Relit une archive locale avec la bibliothèque de référence. */
async function openLocal(path: string): Promise<PMTiles> {
  const data = await readFile(path);
  return new PMTiles({
    getKey: () => path,
    getBytes: (offset: number, length: number) =>
      Promise.resolve({ data: Uint8Array.from(data.subarray(offset, offset + length)).buffer }),
  });
}

/** Tuiles de z0 à z3 couvrant le monde ; contenu = « z/x/y », mer partagée à z3 pour y > 5. */
function worldTiles(): Map<number, Uint8Array> {
  const sea = new TextEncoder().encode('mer');
  const tiles = new Map<number, Uint8Array>();
  for (let z = 0; z <= 3; z++) {
    for (let x = 0; x < 2 ** z; x++) {
      for (let y = 0; y < 2 ** z; y++) {
        tiles.set(
          zxyToTileId(z, x, y),
          z === 3 && y > 5 ? sea : new TextEncoder().encode(`${z}/${x}/${y}`),
        );
      }
    }
  }
  return tiles;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'trains-basemap-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('format PMTiles', () => {
  it('sérialise puis relit un répertoire, décalages contigus compris', () => {
    const entries: Entry[] = [
      { tileId: 0, offset: 0, length: 10, runLength: 1 },
      { tileId: 5, offset: 10, length: 20, runLength: 3 },
      { tileId: 2 ** 40, offset: 5, length: 10, runLength: 1 },
    ];
    expect(deserializeDirectory(serializeDirectory(entries), Compression.Gzip)).toEqual(entries);
  });

  it('refuse une compression de répertoire inconnue', () => {
    expect(() => deserializeDirectory(new Uint8Array([0]), Compression.Brotli)).toThrow(
      /non prise en charge/,
    );
    expect(deserializeDirectory(new Uint8Array([0]), Compression.None)).toEqual([]);
  });

  it('découpe en feuilles quand la racine dépasse son budget', () => {
    const entries: Entry[] = Array.from({ length: 10_000 }, (_, i) => ({
      tileId: i * 3,
      offset: i * 7,
      length: 7 + (i % 5),
      runLength: 1,
    }));
    const { root, leaves } = buildDirectories(entries, 2000);
    expect(root.byteLength).toBeLessThanOrEqual(2000);
    expect(leaves.byteLength).toBeGreaterThan(0);
    const rootEntries = deserializeDirectory(root, Compression.Gzip);
    expect(rootEntries.every((e) => e.runLength === 0)).toBe(true);
  });

  it('calcule les tuiles d’une emprise', () => {
    expect(tileBounds({ west: -180, south: -85, east: 180, north: 85 }, 1)).toEqual({
      minX: 0,
      maxX: 1,
      minY: 0,
      maxY: 1,
    });
    const paris = tileBounds({ west: 2.3, south: 48.85, east: 2.35, north: 48.86 }, 10);
    expect(paris).toEqual({ minX: 518, maxX: 518, minY: 352, maxY: 352 });
    expect(tileIdsInBbox({ west: 0.1, south: 0.1, east: 0.2, north: 0.2 }, 0, 2)).toEqual([
      zxyToTileId(0, 0, 0),
      zxyToTileId(1, 1, 0),
      zxyToTileId(2, 2, 1),
    ]);
  });
});

describe('planRanges', () => {
  it('regroupe les contenus proches et respecte la taille maximale', () => {
    const ranges = planRanges(
      [
        { offset: 0, length: 10 },
        { offset: 12, length: 10 },
        { offset: 100, length: 10 },
        { offset: 112, length: 50 },
      ],
      5,
      40,
    );
    expect(ranges.map((r) => [r.offset, r.length, r.contents.length])).toEqual([
      [0, 22, 2],
      [100, 10, 1],
      [112, 50, 1],
    ]);
  });
});

describe('extractRegion', () => {
  it('extrait une emprise relue à l’identique par la bibliothèque de référence', async () => {
    const source = buildArchive(worldTiles(), 3);
    const outPath = join(dir, 'est.pmtiles');
    const bbox = { west: 10, south: -80, east: 170, north: 80 };
    const reader = memoryReader(source);
    const result = await extractRegion(reader, { bbox, maxZoom: 3, outPath, maxGap: 0 });

    const local = await openLocal(outPath);
    const header = await local.getHeader();
    expect(header).toMatchObject({
      minZoom: 0,
      maxZoom: 3,
      minLon: 10,
      maxLat: 80,
      numAddressedTiles: result.tiles,
    });
    const text = async (z: number, x: number, y: number) => {
      const tile = await local.getZxy(z, x, y);
      return tile ? new TextDecoder().decode(tile.data) : undefined;
    };
    expect(await text(0, 0, 0)).toBe('0/0/0');
    expect(await text(2, 2, 1)).toBe('2/2/1');
    expect(await text(3, 7, 6)).toBe('mer');
    expect(await text(2, 0, 1)).toBeUndefined();
    expect(await local.getMetadata()).toEqual({ version: '4.15.2', name: 'essai' });
    // La mer, partagée, n'est écrite qu'une fois.
    expect(result.contents).toBeLessThan(result.tiles);
    await expect(stat(`${outPath}.part`)).rejects.toThrow();
    expect((await stat(outPath)).size).toBe(result.bytes);
  });

  it('suit les répertoires feuilles de l’archive source', async () => {
    const source = buildArchive(worldTiles(), 3, 60);
    const outPath = join(dir, 'monde.pmtiles');
    await extractRegion(memoryReader(source), {
      bbox: { west: -179, south: -84, east: 179, north: 84 },
      maxZoom: 3,
      outPath,
      concurrency: 2,
    });
    const local = await openLocal(outPath);
    const tile = await local.getZxy(3, 0, 0);
    expect(new TextDecoder().decode(tile?.data)).toBe('3/0/0');
  });

  it('refuse un zoom absent de la source ou une version inconnue', async () => {
    const source = buildArchive(worldTiles(), 3);
    await expect(
      extractRegion(memoryReader(source), { bbox: DATA_BBOX, maxZoom: 5, outPath: join(dir, 'x') }),
    ).rejects.toThrow(/zoom 3/);
    const v2 = source.slice();
    v2[7] = 2;
    await expect(
      extractRegion(memoryReader(v2), { bbox: DATA_BBOX, maxZoom: 3, outPath: join(dir, 'x') }),
    ).rejects.toThrow(/Version PMTiles 2/);
  });
});

describe('httpRangeReader', () => {
  it('envoie un en-tête Range et retente une réponse inattendue', async () => {
    const calls: string[] = [];
    const responses = [new Response('x', { status: 503 }), new Response('abcd', { status: 206 })];
    const reader = httpRangeReader('https://tuiles.test/a.pmtiles', {
      fetchImpl: (_url, init) => {
        calls.push(new Headers(init?.headers).get('range') ?? '');
        return Promise.resolve(responses.shift() as Response);
      },
      backoffMs: () => 0,
    });
    expect(new TextDecoder().decode(await reader.read(10, 4))).toBe('abcd');
    expect(calls).toEqual(['bytes=10-13', 'bytes=10-13']);
  });

  it('abandonne sur une erreur définitive ou des plages tronquées', async () => {
    const notFound = httpRangeReader('https://tuiles.test/a.pmtiles', {
      fetchImpl: () => Promise.resolve(new Response('', { status: 404 })),
      backoffMs: () => 0,
    });
    await expect(notFound.read(0, 4)).rejects.toThrow(/HTTP 404/);
    const short = httpRangeReader('https://tuiles.test/a.pmtiles', {
      fetchImpl: () => Promise.resolve(new Response('ab', { status: 206 })),
      retries: 1,
      backoffMs: () => 0,
    });
    await expect(short.read(0, 4)).rejects.toThrow(/tronquée/);
    const offline = httpRangeReader('https://tuiles.test/a.pmtiles', {
      fetchImpl: () => Promise.reject(new TypeError('fetch failed')),
      retries: 0,
    });
    await expect(offline.read(0, 4)).rejects.toThrow(/fetch failed/);
  });
});

describe('commande basemap', () => {
  const state = (overrides: Partial<BasemapState> = {}): BasemapState => ({
    build: '20261116.pmtiles',
    version: '4.15.2',
    extractedAt: '2026-11-16T00:00:00.000Z',
    maxZoom: MAX_ZOOM,
    bbox: { ...DATA_BBOX },
    sha256: 'a'.repeat(64),
    bytes: 1,
    tiles: 1,
    ...overrides,
  });
  const now = new Date('2026-12-01T00:00:00Z');

  it('choisit le build le plus récent au schéma compatible', () => {
    expect(
      pickBuild([
        { key: '20261114.pmtiles', version: '4.15.2', size: 1 },
        { key: '20261116.pmtiles', version: '5.0.0', size: 1 },
        { key: '20261115.pmtiles', version: '4.15.3', size: 1 },
      ]),
    ).toEqual({ key: '20261115.pmtiles', version: '4.15.3' });
    expect(() => pickBuild([{ key: '20261116.pmtiles', version: '5.0.0', size: 1 }])).toThrow(/v4/);
    expect(majorOf('4.15.2')).toBe(4);
  });

  it('décide quand réextraire', () => {
    expect(staleReason(state(), now, true)).toBeNull();
    expect(staleReason(null, now, false)).toBe('extrait absent');
    expect(staleReason(state(), now, false)).toBe('extrait absent');
    expect(staleReason(state({ version: '5.0.0' }), now, true)).toMatch(/incompatible/);
    expect(staleReason(state({ maxZoom: 12 }), now, true)).toMatch(/zoom 12/);
    expect(staleReason(state({ bbox: { ...DATA_BBOX, west: 0 } }), now, true)).toBe(
      'emprise modifiée',
    );
    const old = new Date(now.getTime() - (MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
    expect(staleReason(state({ extractedAt: old }), now, true)).toMatch(/jours/);
  });

  it('liste les 256 plages de glyphes', () => {
    const ranges = glyphRanges();
    expect(ranges).toHaveLength(256);
    expect(ranges[0]).toBe('0-255');
    expect(ranges[255]).toBe('65280-65535');
  });

  it('extrait, enregistre l’état, puis ne refait rien tant que l’extrait est valable', async () => {
    const archive = buildArchive(worldTiles(), 3);
    const fetchImpl = (url: string) =>
      Promise.resolve(
        new Response(
          url.endsWith('builds.json')
            ? JSON.stringify([{ key: '20261116.pmtiles', version: '4.15.2', size: 1 }])
            : 'asset',
        ),
      );
    // L'archive d'essai s'arrête au zoom 3 : on la présente comme allant au zoom maximal.
    const patched = archive.slice();
    patched[101] = MAX_ZOOM;
    const urls: string[] = [];
    const options = {
      dataDir: dir,
      now,
      fetchImpl,
      readerFor: (url: string) => {
        urls.push(url);
        return memoryReader(patched);
      },
    };
    expect(await updateBasemap(options)).toBe('extracted');
    expect(urls).toEqual(['https://build.protomaps.com/20261116.pmtiles']);
    const saved = JSON.parse(
      await readFile(join(dir, 'tiles', 'france.json'), 'utf8'),
    ) as BasemapState;
    expect(saved).toMatchObject({
      build: '20261116.pmtiles',
      version: '4.15.2',
      maxZoom: MAX_ZOOM,
    });
    expect(
      await readFile(
        join(dir, 'tiles', 'assets', 'fonts', 'Noto Sans Regular', '0-255.pbf'),
        'utf8',
      ),
    ).toBe('asset');
    expect(
      await readFile(join(dir, 'tiles', 'assets', 'sprites', 'v4', 'dark@2x.png'), 'utf8'),
    ).toBe('asset');

    expect(await updateBasemap(options)).toBe('up-to-date');
    expect(urls).toHaveLength(1);
    expect(await updateBasemap({ ...options, force: true })).toBe('extracted');
  });

  it('réextrait si le fichier d’état est illisible', async () => {
    const patched = buildArchive(worldTiles(), 3).slice();
    patched[101] = MAX_ZOOM;
    const options = {
      dataDir: dir,
      now,
      fetchImpl: (url: string) =>
        Promise.resolve(
          new Response(
            url.endsWith('builds.json')
              ? JSON.stringify([{ key: '20261116.pmtiles', version: '4.15.2', size: 1 }])
              : 'asset',
          ),
        ),
      readerFor: () => memoryReader(patched),
    };
    await updateBasemap(options);
    await writeFile(join(dir, 'tiles', 'france.json'), '{ corrompu');
    expect(await updateBasemap(options)).toBe('extracted');
  });
});
