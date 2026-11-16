import { z } from 'zod';
import { roundPosition, simplifyLine, type Position } from '../geo.ts';

const FeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: z
    .object({
      type: z.literal('LineString'),
      coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
    })
    .nullable(),
  properties: z.object({
    code_ligne: z.string(),
    statut: z.string(),
    rg_troncon: z.number().int().nullable().optional(),
  }),
});

const CollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(FeatureSchema),
});

/**
 * Statuts SNCF Réseau ramenés à trois catégories d'affichage : exploitée,
 * neutralisée (voie en place, sans circulation) et fermée (fermée,
 * déclassée, retranchée, transférée en voie de service).
 */
export type LineStatus = 'open' | 'neutralised' | 'closed';

export function classifyStatus(statut: string): LineStatus {
  const s = statut.toLowerCase();
  if (s.startsWith('exploit') || s.includes('travaux')) return 'open';
  if (s.startsWith('neutralis')) return 'neutralised';
  return 'closed';
}

export interface RailLineFeature {
  type: 'Feature';
  properties: { code: string; status: LineStatus; statut: string };
  geometry: { type: 'LineString'; coordinates: Position[] };
}

/** Tolérance de simplification ≈ 5 m : invisible jusqu'au zoom 15. */
const SIMPLIFY_TOLERANCE = 5e-5;

export function buildRailLines(raw: unknown): {
  type: 'FeatureCollection';
  features: RailLineFeature[];
} {
  const features: RailLineFeature[] = [];
  for (const feature of CollectionSchema.parse(raw).features) {
    if (!feature.geometry) continue;
    const coordinates = simplifyLine(
      feature.geometry.coordinates.map((p) => roundPosition(p)),
      SIMPLIFY_TOLERANCE,
    );
    features.push({
      type: 'Feature',
      properties: {
        code: feature.properties.code_ligne,
        status: classifyStatus(feature.properties.statut),
        statut: feature.properties.statut,
      },
      geometry: { type: 'LineString', coordinates },
    });
  }
  // Ordre stable : deux générations identiques produisent le même fichier.
  const firstLng = (f: RailLineFeature): number => (f.geometry.coordinates[0] as Position)[0];
  features.sort(
    (a, b) => a.properties.code.localeCompare(b.properties.code) || firstLng(a) - firstLng(b),
  );
  return { type: 'FeatureCollection', features };
}
