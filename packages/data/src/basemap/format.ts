/**
 * Écriture et lecture des structures PMTiles v3 (en-tête, répertoires),
 * d'après la spécification https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md.
 * La bibliothèque `pmtiles` ne fait que lire ; l'extraction régionale a besoin
 * d'écrire une archive complète.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import { Compression, readVarint, zxyToTileId, type Header } from 'pmtiles';

export const HEADER_BYTES = 127;
/** L'en-tête et le répertoire racine doivent tenir dans les 16 premiers Kio. */
export const ROOT_LIMIT = 16_384;

export interface Entry {
  tileId: number;
  offset: number;
  length: number;
  /** 0 : pointeur vers un répertoire feuille ; ≥ 1 : nombre de tuiles identiques consécutives. */
  runLength: number;
}

// --- Entiers variables (LEB128 non signé) -------------------------------------

function writeVarint(out: number[], value: number): void {
  // Les identifiants de tuile dépassent 2^32 : arithmétique flottante, pas de décalages binaires.
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

// --- Répertoires ---------------------------------------------------------------

export function serializeDirectory(entries: readonly Entry[]): Uint8Array {
  const out: number[] = [];
  writeVarint(out, entries.length);
  let last = 0;
  for (const e of entries) {
    writeVarint(out, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    // 0 signifie « contigu au précédent », sinon décalage + 1.
    if (prev && e.offset === prev.offset + prev.length) writeVarint(out, 0);
    else writeVarint(out, e.offset + 1);
  });
  return gzipSync(Uint8Array.from(out));
}

export function deserializeDirectory(compressed: Uint8Array, compression: Compression): Entry[] {
  let raw: Uint8Array;
  if (compression === Compression.Gzip) raw = gunzipSync(compressed);
  else if (compression === Compression.None) raw = compressed;
  else throw new Error(`Compression de répertoire non prise en charge : ${compression}`);
  const p = { buf: raw, pos: 0 };
  const count = readVarint(p);
  const entries: Entry[] = [];
  let tileId = 0;
  for (let i = 0; i < count; i++) {
    tileId += readVarint(p);
    entries.push({ tileId, offset: 0, length: 0, runLength: 1 });
  }
  for (const e of entries) e.runLength = readVarint(p);
  for (const e of entries) e.length = readVarint(p);
  entries.forEach((e, i) => {
    const v = readVarint(p);
    const prev = entries[i - 1];
    if (v === 0 && prev) e.offset = prev.offset + prev.length;
    else e.offset = v - 1;
  });
  return entries;
}

// --- En-tête -------------------------------------------------------------------

function setUint64(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value % 2 ** 32, true);
  view.setUint32(offset + 4, Math.floor(value / 2 ** 32), true);
}

export function serializeHeader(h: Header): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('PMTiles'), 0);
  view.setUint8(7, 3);
  setUint64(view, 8, h.rootDirectoryOffset);
  setUint64(view, 16, h.rootDirectoryLength);
  setUint64(view, 24, h.jsonMetadataOffset);
  setUint64(view, 32, h.jsonMetadataLength);
  setUint64(view, 40, h.leafDirectoryOffset);
  setUint64(view, 48, h.leafDirectoryLength ?? 0);
  setUint64(view, 56, h.tileDataOffset);
  setUint64(view, 64, h.tileDataLength ?? 0);
  setUint64(view, 72, h.numAddressedTiles);
  setUint64(view, 80, h.numTileEntries);
  setUint64(view, 88, h.numTileContents);
  view.setUint8(96, h.clustered ? 1 : 0);
  view.setUint8(97, h.internalCompression);
  view.setUint8(98, h.tileCompression);
  view.setUint8(99, h.tileType);
  view.setUint8(100, h.minZoom);
  view.setUint8(101, h.maxZoom);
  view.setInt32(102, Math.round(h.minLon * 1e7), true);
  view.setInt32(106, Math.round(h.minLat * 1e7), true);
  view.setInt32(110, Math.round(h.maxLon * 1e7), true);
  view.setInt32(114, Math.round(h.maxLat * 1e7), true);
  view.setUint8(118, h.centerZoom);
  view.setInt32(119, Math.round(h.centerLon * 1e7), true);
  view.setInt32(123, Math.round(h.centerLat * 1e7), true);
  return bytes;
}

/**
 * Répartit les entrées entre une racine et des répertoires feuilles, en
 * doublant la taille des feuilles jusqu'à ce que la racine tienne dans la
 * limite (même stratégie que l'outil de référence).
 */
export function buildDirectories(
  entries: readonly Entry[],
  rootBudget = ROOT_LIMIT - HEADER_BYTES,
): { root: Uint8Array; leaves: Uint8Array } {
  const root = serializeDirectory(entries);
  if (root.byteLength <= rootBudget) return { root, leaves: new Uint8Array(0) };

  for (let leafSize = 4096; ; leafSize *= 2) {
    const leafChunks: Uint8Array[] = [];
    const rootEntries: Entry[] = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const chunk = entries.slice(i, i + leafSize);
      const leaf = serializeDirectory(chunk);
      rootEntries.push({
        tileId: (chunk[0] as Entry).tileId,
        offset,
        length: leaf.byteLength,
        runLength: 0,
      });
      leafChunks.push(leaf);
      offset += leaf.byteLength;
    }
    const candidate = serializeDirectory(rootEntries);
    if (candidate.byteLength <= rootBudget) {
      const leaves = new Uint8Array(offset);
      let cursor = 0;
      for (const chunk of leafChunks) {
        leaves.set(chunk, cursor);
        cursor += chunk.byteLength;
      }
      return { root: candidate, leaves };
    }
  }
}

// --- Sélection géographique ----------------------------------------------------

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Indices de tuiles Web Mercator couvrant l'emprise au zoom donné. */
export function tileBounds(
  bbox: Bbox,
  z: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const n = 2 ** z;
  const x = (lng: number) => Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n)));
  const y = (lat: number) => {
    const phi = (lat * Math.PI) / 180;
    const v = Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n);
    return Math.min(n - 1, Math.max(0, v));
  };
  return { minX: x(bbox.west), maxX: x(bbox.east), minY: y(bbox.north), maxY: y(bbox.south) };
}

/** Identifiants (courbe de Hilbert) de toutes les tuiles de l'emprise, triés. */
export function tileIdsInBbox(bbox: Bbox, minZoom: number, maxZoom: number): number[] {
  const ids: number[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const b = tileBounds(bbox, z);
    for (let x = b.minX; x <= b.maxX; x++) {
      for (let y = b.minY; y <= b.maxY; y++) ids.push(zxyToTileId(z, x, y));
    }
  }
  return ids.sort((a, b) => a - b);
}
