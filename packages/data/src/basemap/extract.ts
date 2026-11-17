import { open, rename, rm } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { bytesToHeader, Compression, type Header } from 'pmtiles';
import type { FetchLike } from '../http.ts';
import {
  buildDirectories,
  deserializeDirectory,
  HEADER_BYTES,
  ROOT_LIMIT,
  serializeHeader,
  tileIdsInBbox,
  type Bbox,
  type Entry,
} from './format.ts';

/** Lecture d'une plage d'octets d'une archive, locale ou distante. */
export interface RangeReader {
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface HttpRangeOptions {
  fetchImpl?: FetchLike;
  retries?: number;
  timeoutMs?: number;
  backoffMs?: (attempt: number) => number;
}

/**
 * Lecteur HTTP par requêtes Range, avec reprises. Les archives Protomaps
 * sont immuables (une URL par jour de build) : pas de risque de mélanger deux
 * versions d'un même fichier.
 */
export function httpRangeReader(url: string, options: HttpRangeOptions = {}): RangeReader {
  const {
    fetchImpl = fetch,
    retries = 5,
    timeoutMs = 300_000,
    backoffMs = (n) => 1000 * 2 ** (n - 1),
  } = options;
  return {
    async read(offset, length) {
      let lastError: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        try {
          const response = await fetchImpl(url, {
            headers: { range: `bytes=${offset}-${offset + length - 1}` },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (response.status !== 206) {
            lastError = new Error(`HTTP ${response.status} (206 attendu)`);
            if (response.status >= 400 && response.status < 500 && response.status !== 429) break;
            continue;
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength !== length) {
            lastError = new Error(`plage tronquée (${bytes.byteLength}/${length} octets)`);
            continue;
          }
          return bytes;
        } catch (error) {
          lastError = error;
        }
      }
      const reason = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Lecture de ${url} [${offset}, +${length}] impossible : ${reason}`, {
        cause: lastError,
      });
    },
  };
}

interface Hit {
  tileId: number;
  offset: number;
  length: number;
}

/** Associe chaque identifiant demandé à son contenu, en descendant dans les feuilles utiles. */
async function resolve(
  reader: RangeReader,
  header: Header,
  entries: readonly Entry[],
  ids: readonly number[],
  concurrency: number,
): Promise<Hit[]> {
  const hits: Hit[] = [];
  const leaves: { entry: Entry; ids: number[] }[] = [];
  let i = 0;
  entries.forEach((entry, k) => {
    const end =
      entry.runLength > 0 ? entry.tileId + entry.runLength : (entries[k + 1]?.tileId ?? Infinity);
    while (i < ids.length && (ids[i] as number) < entry.tileId) i++;
    const inside: number[] = [];
    while (i < ids.length && (ids[i] as number) < end) inside.push(ids[i++] as number);
    if (inside.length === 0) return;
    if (entry.runLength > 0) {
      for (const tileId of inside)
        hits.push({ tileId, offset: entry.offset, length: entry.length });
    } else {
      leaves.push({ entry, ids: inside });
    }
  });

  for (let start = 0; start < leaves.length; start += concurrency) {
    const batch = leaves.slice(start, start + concurrency);
    const results = await Promise.all(
      batch.map(async ({ entry, ids: subset }) => {
        const bytes = await reader.read(header.leafDirectoryOffset + entry.offset, entry.length);
        const children = deserializeDirectory(bytes, header.internalCompression);
        return resolve(reader, header, children, subset, concurrency);
      }),
    );
    for (const r of results) hits.push(...r);
  }
  return hits;
}

/** Regroupe des contenus proches en plages de lecture, pour limiter le nombre de requêtes. */
export function planRanges(
  contents: readonly { offset: number; length: number }[],
  maxGap: number,
  maxRange: number,
): { offset: number; length: number; contents: { offset: number; length: number }[] }[] {
  const ranges: {
    offset: number;
    length: number;
    contents: { offset: number; length: number }[];
  }[] = [];
  for (const c of contents) {
    const last = ranges[ranges.length - 1];
    const lastEnd = last ? last.offset + last.length : -Infinity;
    if (last && c.offset - lastEnd <= maxGap && c.offset + c.length - last.offset <= maxRange) {
      last.length = Math.max(last.length, c.offset + c.length - last.offset);
      last.contents.push(c);
    } else {
      ranges.push({ offset: c.offset, length: c.length, contents: [c] });
    }
  }
  return ranges;
}

export interface ExtractOptions {
  bbox: Bbox;
  minZoom?: number;
  maxZoom: number;
  outPath: string;
  concurrency?: number;
  /** Écart maximal lu « pour rien » entre deux contenus d'une même requête. */
  maxGap?: number;
  maxRange?: number;
  log?: (message: string) => void;
}

export interface ExtractResult {
  tiles: number;
  contents: number;
  bytes: number;
}

/**
 * Extrait une emprise d'une archive PMTiles v3 vers un fichier local, écrit
 * sous un nom temporaire puis renommé : jamais de fichier partiel en service.
 */
export async function extractRegion(
  reader: RangeReader,
  options: ExtractOptions,
): Promise<ExtractResult> {
  const {
    bbox,
    minZoom = 0,
    maxZoom,
    outPath,
    concurrency = 8,
    maxGap = 512 * 1024,
    maxRange = 16 * 1024 * 1024,
    log = () => undefined,
  } = options;

  const head = await reader.read(0, ROOT_LIMIT);
  // Copie dans un ArrayBuffer dédié : bytesToHeader n'accepte pas une vue partagée.
  const header = bytesToHeader(Uint8Array.from(head).buffer);
  if (header.specVersion !== 3)
    throw new Error(`Version PMTiles ${header.specVersion} non prise en charge`);
  if (header.maxZoom < maxZoom) throw new Error(`Archive limitée au zoom ${header.maxZoom}`);

  const root = deserializeDirectory(
    head.subarray(
      header.rootDirectoryOffset,
      header.rootDirectoryOffset + header.rootDirectoryLength,
    ),
    header.internalCompression,
  );
  const ids = tileIdsInBbox(bbox, minZoom, maxZoom);
  log(`  ${ids.length} tuiles candidates (z${minZoom}–${maxZoom})`);
  const hits = (await resolve(reader, header, root, ids, concurrency)).sort(
    (a, b) => a.tileId - b.tileId,
  );

  // Contenus distincts (les tuiles identiques, comme la mer, partagent un contenu).
  const unique = new Map<number, number>();
  for (const h of hits) unique.set(h.offset, h.length);
  const contents = [...unique.entries()]
    .map(([offset, length]) => ({ offset, length }))
    .sort((a, b) => a.offset - b.offset);
  const ranges = planRanges(contents, maxGap, maxRange);
  const totalBytes = contents.reduce((s, c) => s + c.length, 0);
  log(
    `  ${hits.length} tuiles, ${contents.length} contenus, ${(totalBytes / 1e6).toFixed(0)} Mo, ${ranges.length} requêtes`,
  );

  // Une seule passe sur le fichier final, sans copie intermédiaire (pic disque
  // = taille de l'archive) : 16 Kio réservés pour l'en-tête et la racine, puis
  // les tuiles au fil des lectures, puis métadonnées et feuilles, et enfin
  // l'en-tête réécrit en tête. La spécification autorise cet ordre.
  const partial = `${outPath}.part`;
  const file = await open(partial, 'w');
  const newOffsets = new Map<number, number>();
  let cursor = 0;
  let out: Header;
  try {
    await file.write(new Uint8Array(ROOT_LIMIT), 0, ROOT_LIMIT, 0);
    for (let start = 0; start < ranges.length; start += concurrency) {
      const batch = ranges.slice(start, start + concurrency);
      const buffers = await Promise.all(
        batch.map((r) => reader.read(header.tileDataOffset + r.offset, r.length)),
      );
      // Écriture dans l'ordre des décalages source : l'archive reste ordonnée.
      for (const [index, range] of batch.entries()) {
        const buffer = buffers[index] as Uint8Array;
        for (const c of range.contents) {
          const slice = buffer.subarray(
            c.offset - range.offset,
            c.offset - range.offset + c.length,
          );
          await file.write(slice, 0, slice.byteLength, ROOT_LIMIT + cursor);
          newOffsets.set(c.offset, cursor);
          cursor += c.length;
        }
      }
      if (start % (concurrency * 25) === 0) {
        log(`  ${Math.min(start + concurrency, ranges.length)}/${ranges.length} requêtes`);
      }
    }

    // Entrées de sortie, fusionnées en séries quand des tuiles consécutives
    // partagent un contenu.
    const entries: Entry[] = [];
    let clustered = true;
    let maxFirstOffset = -1;
    const seen = new Set<number>();
    for (const h of hits) {
      const offset = newOffsets.get(h.offset) as number;
      if (!seen.has(offset)) {
        seen.add(offset);
        if (offset < maxFirstOffset) clustered = false;
        maxFirstOffset = offset;
      }
      const prev = entries[entries.length - 1];
      if (prev?.offset === offset && prev.tileId + prev.runLength === h.tileId) {
        prev.runLength++;
      } else {
        entries.push({ tileId: h.tileId, offset, length: h.length, runLength: 1 });
      }
    }

    const metadataRaw = await reader.read(header.jsonMetadataOffset, header.jsonMetadataLength);
    const metadataJson =
      header.internalCompression === Compression.Gzip ? gunzipSync(metadataRaw) : metadataRaw;
    const metadata = gzipSync(metadataJson);
    const { root: rootDir, leaves } = buildDirectories(entries);
    const metadataOffset = ROOT_LIMIT + cursor;
    const leavesOffset = metadataOffset + metadata.byteLength;

    out = {
      ...header,
      rootDirectoryOffset: HEADER_BYTES,
      rootDirectoryLength: rootDir.byteLength,
      jsonMetadataOffset: metadataOffset,
      jsonMetadataLength: metadata.byteLength,
      leafDirectoryOffset: leavesOffset,
      leafDirectoryLength: leaves.byteLength,
      tileDataOffset: ROOT_LIMIT,
      tileDataLength: cursor,
      numAddressedTiles: hits.length,
      numTileEntries: entries.length,
      numTileContents: contents.length,
      clustered,
      internalCompression: Compression.Gzip,
      minZoom,
      maxZoom,
      minLon: bbox.west,
      minLat: bbox.south,
      maxLon: bbox.east,
      maxLat: bbox.north,
      centerZoom: Math.min(maxZoom, Math.max(minZoom, 5)),
      centerLon: (bbox.west + bbox.east) / 2,
      centerLat: (bbox.south + bbox.north) / 2,
    };
    await file.write(metadata, 0, metadata.byteLength, metadataOffset);
    await file.write(leaves, 0, leaves.byteLength, leavesOffset);
    const head = serializeHeader(out);
    await file.write(head, 0, head.byteLength, 0);
    await file.write(rootDir, 0, rootDir.byteLength, HEADER_BYTES);
    await file.sync();
  } catch (error) {
    await file.close();
    await rm(partial, { force: true });
    throw error;
  }
  await file.close();
  await rename(partial, outPath);
  return {
    tiles: hits.length,
    contents: contents.length,
    bytes: out.leafDirectoryOffset + (out.leafDirectoryLength ?? 0),
  };
}
