import { polylineLength } from '@trains/engine';
import type { Network } from '@trains/shared';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { smoothedPath } from '../editor/geometry.ts';

type ExportFeature = Feature<LineString | Point, Record<string, string | number | boolean | null>>;

/**
 * Réseau du joueur en GeoJSON (WGS 84), pour un SIG ou un autre outil :
 * tronçons au tracé lissé avec leurs caractéristiques, nœuds avec leur
 * rôle. Export seul : la sauvegarde JSON reste le format de référence.
 */
export function networkToGeoJSON(network: Network): FeatureCollection {
  const features: ExportFeature[] = [];
  for (const segment of Object.values(network.segments)) {
    const path = smoothedPath(network, segment);
    features.push({
      type: 'Feature',
      id: segment.id,
      geometry: { type: 'LineString', coordinates: path.map((p) => [p[0], p[1]]) },
      properties: {
        type: 'troncon',
        de: segment.from,
        vers: segment.to,
        longueur_m: Math.round(polylineLength(path)),
        voies: segment.spec.tracks,
        vitesse_kmh: segment.spec.designSpeedKmh,
        ecartement: segment.spec.gauge,
        electrification: segment.spec.electrification,
        signalisation: segment.spec.signalling,
      },
    });
  }
  for (const node of Object.values(network.nodes)) {
    features.push({
      type: 'Feature',
      id: node.id,
      geometry: { type: 'Point', coordinates: [node.position[0], node.position[1]] },
      properties: {
        type: node.kind === 'station' ? 'gare' : node.kind === 'junction' ? 'bifurcation' : 'point',
        nom: node.name ?? null,
        ...(node.station
          ? {
              categorie: node.station.type,
              quais: node.station.platforms,
              terminus: node.station.terminus,
              uic: node.station.existingUic ?? null,
            }
          : {}),
        ...(node.kind === 'junction' ? { saut_de_mouton: node.flyover ?? false } : {}),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Nom de fichier sûr tiré du nom de la partie. */
export function fileName(name: string, extension: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'reseau'}.${extension}`;
}

/** Fait télécharger un texte par le navigateur. */
export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
