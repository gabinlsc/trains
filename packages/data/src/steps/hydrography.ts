import { z } from 'zod';
import { roundPosition, simplifyLine, type Position } from '../geo.ts';

/** Taille de page maximale acceptée par le WFS de la Géoplateforme. */
export const WFS_PAGE_SIZE = 5000;

const FILTER = "classe_de_largeur IN ('Plus de 50 m','Entre 15 et 50 m') AND fictif=false";
const PROPERTIES =
  'geometrie,classe_de_largeur,cpx_toponyme_de_cours_d_eau,code_du_cours_d_eau_bdcarthage';

/**
 * URL d'une page. CRS:84 garantit l'ordre longitude, latitude ; le tri par
 * identifiant rend la pagination stable d'une requête à l'autre.
 */
export function hydrographyPageUrl(base: string, startIndex: number): string {
  const params = new URLSearchParams({
    OUTPUTFORMAT: 'application/json',
    SRSNAME: 'CRS:84',
    COUNT: String(WFS_PAGE_SIZE),
    STARTINDEX: String(startIndex),
    SORTBY: 'cleabs',
    PROPERTYNAME: PROPERTIES,
    CQL_FILTER: FILTER,
  });
  return `${base}&${params.toString()}`;
}

const LineGeometry = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('LineString'),
    coordinates: z.array(z.tuple([z.number(), z.number()])),
  }),
  z.object({
    type: z.literal('MultiLineString'),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  }),
]);

export const HydroPageSchema = z.object({
  numberMatched: z.number().int().nonnegative(),
  features: z.array(
    z.object({
      geometry: LineGeometry.nullable(),
      properties: z.object({
        classe_de_largeur: z.string().nullable(),
        cpx_toponyme_de_cours_d_eau: z.string().nullable(),
        code_du_cours_d_eau_bdcarthage: z.string().nullable(),
      }),
    }),
  ),
});
export type HydroPage = z.infer<typeof HydroPageSchema>;

/** 1 : 15 à 50 m ; 2 : plus de 50 m. Sert au coût des ponts et au style. */
export type WidthClass = 1 | 2;

export interface RiverFeature {
  type: 'Feature';
  properties: { nom: string; largeur: WidthClass };
  geometry: { type: 'LineString'; coordinates: Position[] };
}

const TOLERANCE = 1e-4;
const key = ([lng, lat]: Position): string => `${lng},${lat}`;

/**
 * Raccorde bout à bout les tronçons d'un même groupe (même cours d'eau, même
 * classe de largeur) : des dizaines de milliers de tronçons deviennent
 * quelques milliers de lignes, ce qui allège fortement le fichier.
 */
export function chainSegments(segments: Position[][]): Position[][] {
  const byStart = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    const k = key(segment[0] as Position);
    byStart.set(k, [...(byStart.get(k) ?? []), index]);
  });
  const hasPredecessor = new Set<number>();
  segments.forEach((segment) => {
    for (const next of byStart.get(key(segment[segment.length - 1] as Position)) ?? []) {
      hasPredecessor.add(next);
    }
  });

  const used = new Uint8Array(segments.length);
  const chains: Position[][] = [];
  const follow = (start: number): void => {
    const chain = [...(segments[start] as Position[])];
    used[start] = 1;
    for (;;) {
      const candidates = byStart.get(key(chain[chain.length - 1] as Position)) ?? [];
      const next = candidates.find((i) => used[i] === 0);
      if (next === undefined) break;
      used[next] = 1;
      chain.push(...(segments[next] as Position[]).slice(1));
    }
    chains.push(chain);
  };
  // D'abord depuis les débuts de chaîne, puis ce qui reste (boucles, confluences).
  segments.forEach((_, i) => {
    if (!hasPredecessor.has(i) && used[i] === 0) follow(i);
  });
  segments.forEach((_, i) => {
    if (used[i] === 0) follow(i);
  });
  return chains;
}

export function buildRivers(pages: readonly unknown[]): {
  type: 'FeatureCollection';
  features: RiverFeature[];
} {
  const groups = new Map<string, { nom: string; largeur: WidthClass; segments: Position[][] }>();
  for (const raw of pages) {
    for (const feature of HydroPageSchema.parse(raw).features) {
      if (!feature.geometry) continue;
      const largeur: WidthClass = feature.properties.classe_de_largeur === 'Plus de 50 m' ? 2 : 1;
      const nom = feature.properties.cpx_toponyme_de_cours_d_eau?.trim() ?? '';
      const code = feature.properties.code_du_cours_d_eau_bdcarthage ?? nom;
      const groupKey = `${code}|${largeur}`;
      const group = groups.get(groupKey) ?? { nom, largeur, segments: [] };
      const lines =
        feature.geometry.type === 'LineString'
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates;
      for (const line of lines) {
        if (line.length >= 2) group.segments.push(line.map((p) => roundPosition(p)));
      }
      groups.set(groupKey, group);
    }
  }

  const features: RiverFeature[] = [];
  for (const { nom, largeur, segments } of groups.values()) {
    for (const chain of chainSegments(segments)) {
      const coordinates = simplifyLine(chain, TOLERANCE);
      if (coordinates.length < 2) continue;
      features.push({
        type: 'Feature',
        properties: { nom, largeur },
        geometry: { type: 'LineString', coordinates },
      });
    }
  }
  // Les grands cours d'eau d'abord : ils se dessinent sous les petits.
  features.sort(
    (a, b) =>
      b.properties.largeur - a.properties.largeur ||
      a.properties.nom.localeCompare(b.properties.nom, 'fr') ||
      (a.geometry.coordinates[0] as Position)[0] - (b.geometry.coordinates[0] as Position)[0],
  );
  return { type: 'FeatureCollection', features };
}
