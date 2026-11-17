import { checkCurvature, minRadiusForSpeed, smoothAlignment, type LngLat } from '@trains/engine';
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
  nodes: FeatureCollection<Point, { id: string; kind: string; name: string }>;
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
    properties: { id: node.id, kind: node.kind, name: node.name ?? '' },
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
