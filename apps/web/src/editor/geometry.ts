import {
  checkCurvature,
  lineRoute,
  minRadiusForSpeed,
  smoothAlignment,
  type LngLat,
} from '@trains/engine';
import { segmentPath, type Network, type Position, type Segment } from '@trains/shared';
import type { FeatureCollection, LineString, Point } from 'geojson';

/**
 * Tracé affiché d'un tronçon : les points saisis sont raccordés par des arcs
 * au rayon minimal de la vitesse de conception. Les points saisis restent la
 * donnée de référence (stockés dans `via`) ; le lissage est recalculé.
 */
export function smoothedPath(network: Network, segment: Segment): LngLat[] {
  return smoothAlignment(segmentPath(network, segment), {
    radius: minRadiusForSpeed(segment.spec.designSpeedKmh),
  });
}

export interface NetworkGeoJSON {
  segments: FeatureCollection<
    LineString,
    { id: string; speed: number; tracks: number; issues: number }
  >;
  nodes: FeatureCollection<
    Point,
    /** station : type de gare, vide pour un autre nœud. */
    { id: string; kind: string; name: string; station: string; flyover: boolean }
  >;
  /** Sommets où le rayon exigé n'est pas tenu (alignements trop courts, angles vifs). */
  issues: FeatureCollection<Point, { segment: string; radius: number; required: number }>;
}

export function networkToGeoJSON(network: Network): NetworkGeoJSON {
  const segments: NetworkGeoJSON['segments']['features'] = [];
  const issues: NetworkGeoJSON['issues']['features'] = [];
  for (const segment of Object.values(network.segments)) {
    const path = smoothedPath(network, segment);
    const found = checkCurvature(path, minRadiusForSpeed(segment.spec.designSpeedKmh));
    segments.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: path.map((p) => [p[0], p[1]]) },
      properties: {
        id: segment.id,
        speed: segment.spec.designSpeedKmh,
        tracks: segment.spec.tracks,
        issues: found.length,
      },
    });
    for (const issue of found) {
      const at = path[issue.index] as LngLat;
      issues.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [at[0], at[1]] },
        properties: {
          segment: segment.id,
          radius: Math.round(issue.radius),
          required: Math.round(issue.required),
        },
      });
    }
  }
  const nodes: NetworkGeoJSON['nodes']['features'] = Object.values(network.nodes).map((node) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [node.position[0], node.position[1]] },
    properties: {
      id: node.id,
      kind: node.kind,
      name: node.name ?? '',
      station: node.station?.type ?? '',
      flyover: node.flyover ?? false,
    },
  }));
  return {
    segments: { type: 'FeatureCollection', features: segments },
    nodes: { type: 'FeatureCollection', features: nodes },
    issues: { type: 'FeatureCollection', features: issues },
  };
}

/** Prévisualisation du tronçon en cours de tracé, lissée comme le résultat final. */
export function previewPath(points: readonly Position[], speedKmh: number): LngLat[] {
  return smoothAlignment(points, { radius: minRadiusForSpeed(speedKmh) });
}

export type LineFeatures = FeatureCollection<
  LineString,
  { id: string; code: string; color: string; offset: number }
>;

/**
 * Tracé des lignes commerciales sur le réseau lissé. Les lignes qui
 * partagent des tronçons sont décalées latéralement (index de la ligne) pour
 * rester distinctes ; une ligne dont un intervalle n'est pas relié ne
 * dessine que ses parties reliées.
 */
export function linesToGeoJSON(network: Network): LineFeatures {
  const features: LineFeatures['features'] = [];
  Object.values(network.lines).forEach((line, index) => {
    const route = lineRoute(network, line);
    for (const leg of route.legs) {
      if (!leg || leg.steps.length === 0) continue;
      const coordinates: [number, number][] = [];
      for (const step of leg.steps) {
        const segment = network.segments[step.segment];
        if (!segment) continue;
        const path = smoothedPath(network, segment);
        const ordered = step.reversed ? [...path].reverse() : path;
        for (const p of ordered) {
          const last = coordinates.at(-1);
          if (last?.[0] !== p[0] || last[1] !== p[1]) coordinates.push([p[0], p[1]]);
        }
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: { id: line.id, code: line.code, color: line.color, offset: index % 6 },
      });
    }
  });
  return { type: 'FeatureCollection', features };
}
