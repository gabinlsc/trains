import { z } from 'zod';
import { inDataBbox, roundPosition } from '../geo.ts';
import type { Table } from './communes.ts';

const GareSchema = z.object({
  nom: z.string(),
  libellecourt: z.string().nullable(),
  segment_drg: z.string().nullable(),
  position_geographique: z.object({ lon: z.number(), lat: z.number() }).nullable(),
  codeinsee: z.string().nullable(),
  codes_uic: z.string().nullable(),
});

/**
 * Segments DRG de SNCF Gares & Connexions : A (gares nationales, plus de
 * 250 000 voyageurs/an hors TER), B (régionales), C (locales).
 */
export type Segment = 'A' | 'B' | 'C';

export type GareRow = [
  uic: string,
  nom: string,
  trigramme: string,
  segment: Segment,
  insee: string,
  lng: number,
  lat: number,
];

/** Une gare peut cumuler plusieurs segments (« A;B ») : on retient le plus élevé. */
export function bestSegment(raw: string | null): Segment {
  const values = (raw ?? '').split(';').map((s) => s.trim());
  if (values.includes('A')) return 'A';
  if (values.includes('B')) return 'B';
  return 'C';
}

export function buildGares(raw: unknown): Table<GareRow> {
  const rows: GareRow[] = [];
  const seen = new Set<string>();
  for (const gare of z.array(GareSchema).parse(raw)) {
    const position = gare.position_geographique;
    if (!position) continue;
    const point = roundPosition([position.lon, position.lat]);
    if (!inDataBbox(point)) continue;
    // Plusieurs codes UIC pour un même bâtiment : le premier sert d'identifiant.
    const uic = (gare.codes_uic ?? '').split(/[;,]/)[0]?.trim() ?? '';
    const id = uic || `${gare.nom}@${point.join(',')}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push([
      uic,
      gare.nom.trim(),
      gare.libellecourt ?? '',
      bestSegment(gare.segment_drg),
      gare.codeinsee ?? '',
      point[0],
      point[1],
    ]);
  }
  rows.sort((a, b) => a[3].localeCompare(b[3]) || a[1].localeCompare(b[1], 'fr'));
  return { fields: ['uic', 'nom', 'trigramme', 'segment', 'insee', 'lng', 'lat'], rows };
}
