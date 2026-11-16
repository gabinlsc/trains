import { z } from 'zod';
import { isInWorkArea, roundCoord } from '../geo.ts';

const PolygonalSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  }),
  z.object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(z.array(z.tuple([z.number(), z.number()])))),
  }),
]);
export type Polygonal = z.infer<typeof PolygonalSchema>;

const ContoursSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      properties: z.object({ code: z.string(), nom: z.string() }).loose(),
      geometry: PolygonalSchema,
    }),
  ),
});

export interface BoundaryFeature {
  type: 'Feature';
  properties: { code: string; nom: string };
  geometry: Polygonal;
}

/** Arrondi à 4 décimales (≈ 10 m), cohérent avec une généralisation à 100 m. */
function roundGeometry(geometry: Polygonal): Polygonal {
  const ring = (points: [number, number][]): [number, number][] =>
    points.map(([lng, lat]) => [roundCoord(lng, 4), roundCoord(lat, 4)]);
  return geometry.type === 'Polygon'
    ? { type: 'Polygon', coordinates: geometry.coordinates.map(ring) }
    : { type: 'MultiPolygon', coordinates: geometry.coordinates.map((poly) => poly.map(ring)) };
}

/**
 * Contours déjà généralisés par Etalab : on se contente d'exclure l'outre-mer
 * (DROM et collectivités)
 * et d'arrondir. Une simplification supplémentaire casserait la topologie
 * partagée entre départements voisins.
 */
export function buildBoundaries(raw: unknown): {
  type: 'FeatureCollection';
  features: BoundaryFeature[];
} {
  const features = ContoursSchema.parse(raw)
    .features.filter((f) => isInWorkArea(f.geometry.coordinates))
    .map((f): BoundaryFeature => ({
      type: 'Feature',
      properties: { code: f.properties.code, nom: f.properties.nom },
      geometry: roundGeometry(f.geometry),
    }))
    .sort((a, b) => a.properties.code.localeCompare(b.properties.code));
  return { type: 'FeatureCollection', features };
}
