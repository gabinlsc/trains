import { z } from 'zod';
import { isInWorkArea, roundPosition, simplifyLine, type Position } from '../geo.ts';

const ParcSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      properties: z.object({ code_r_enp: z.string(), gest_site: z.string() }).loose(),
      geometry: z.object({
        type: z.literal('MultiPolygon'),
        coordinates: z.array(z.array(z.array(z.tuple([z.number(), z.number()])))),
      }),
    }),
  ),
});

/**
 * Zonages terrestres retenus : le cœur, où le moteur interdit de construire,
 * et l'aire d'adhésion, où la construction subit un surcoût. Les zonages
 * marins (cœur marin, aire maritime adjacente) sont sans objet.
 */
export type ParkZone = 'coeur' | 'adhesion';
const ZONES: Record<string, ParkZone> = { CTPN: 'coeur', AAPN: 'adhesion' };

export interface ProtectedAreaFeature {
  type: 'Feature';
  properties: { nom: string; zone: ParkZone };
  geometry: { type: 'MultiPolygon'; coordinates: Position[][][] };
}

/** Tolérance ≈ 20 m : les contours d'origine sont au mètre, inutile pour l'échelle du jeu. */
const TOLERANCE = 2e-4;

function simplifyRing(ring: readonly Position[]): Position[] | null {
  const simplified = simplifyLine(
    ring.map((p) => roundPosition(p)),
    TOLERANCE,
  );
  // Un anneau valide compte au moins quatre points (le premier répété) :
  // en dessous, c'est un îlot minuscule qui disparaît à cette échelle.
  return simplified.length >= 4 ? simplified : null;
}

export function normaliseParkName(gestionnaire: string): string {
  return gestionnaire.replace(/\s+/g, ' ').trim();
}

export function buildProtectedAreas(raw: unknown): {
  type: 'FeatureCollection';
  features: ProtectedAreaFeature[];
} {
  const features: ProtectedAreaFeature[] = [];
  for (const feature of ParcSchema.parse(raw).features) {
    const zone = ZONES[feature.properties.code_r_enp];
    // Les parcs d'outre-mer (Guyane, Guadeloupe, Réunion) sont hors carte.
    if (!zone || !isInWorkArea(feature.geometry.coordinates)) continue;
    const polygons: Position[][][] = [];
    for (const polygon of feature.geometry.coordinates) {
      const [outer, ...holes] = polygon.map(simplifyRing);
      if (!outer) continue;
      polygons.push([outer, ...holes.filter((h): h is Position[] => h !== null)]);
    }
    if (polygons.length === 0) continue;
    features.push({
      type: 'Feature',
      properties: { nom: normaliseParkName(feature.properties.gest_site), zone },
      geometry: { type: 'MultiPolygon', coordinates: polygons },
    });
  }
  features.sort(
    (a, b) =>
      a.properties.nom.localeCompare(b.properties.nom, 'fr') ||
      a.properties.zone.localeCompare(b.properties.zone),
  );
  return { type: 'FeatureCollection', features };
}
