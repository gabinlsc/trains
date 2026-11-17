import { addProtocol, type SourceSpecification } from 'maplibre-gl';
import mlcontour from 'maplibre-contour';
import { loadManifest } from './data.ts';

export const RELIEF_DEM_SOURCE = 'relief-dem';
export const RELIEF_CONTOURS_SOURCE = 'relief-contours';
export const CONTOURS_LAYER = 'contours';

/** Tuiles d'altitude produites par le pipeline (zooms 5 à 9). */
const RELIEF_MIN_ZOOM = 5;
const RELIEF_MAX_ZOOM = 9;

let demSource: InstanceType<typeof mlcontour.DemSource> | null = null;

/**
 * Sources du relief : la même pyramide de tuiles Terrarium alimente
 * l'ombrage (raster-dem natif) et les courbes de niveau, calculées dans un
 * worker par maplibre-contour. Rien n'est précalculé côté serveur.
 */
export async function reliefSources(origin: string): Promise<Record<string, SourceSpecification>> {
  const manifest = await loadManifest();
  if (!manifest.outputs.some((o) => o.file === 'relief/')) {
    throw new Error(`relief absent de la génération ${manifest.dataVersion}`);
  }
  const url = `${origin}/data/${manifest.dataVersion}/relief/{z}/{x}/{y}.png`;
  if (!demSource) {
    demSource = new mlcontour.DemSource({
      url,
      encoding: 'terrarium',
      maxzoom: RELIEF_MAX_ZOOM,
      worker: true,
    });
    demSource.setupMaplibre({ addProtocol });
  }
  return {
    [RELIEF_DEM_SOURCE]: {
      type: 'raster-dem',
      tiles: [url],
      encoding: 'terrarium',
      tileSize: 256,
      minzoom: RELIEF_MIN_ZOOM,
      maxzoom: RELIEF_MAX_ZOOM,
    },
    [RELIEF_CONTOURS_SOURCE]: {
      type: 'vector',
      tiles: [
        demSource.contourProtocolUrl({
          // Équidistance [normale, maîtresse] selon le zoom, en mètres.
          thresholds: { 8: [250, 1000], 10: [100, 500], 12: [50, 250], 13: [20, 100] },
          contourLayer: CONTOURS_LAYER,
          elevationKey: 'ele',
          levelKey: 'level',
          overzoom: 1,
        }),
      ],
      minzoom: 8,
      maxzoom: 15,
    },
  };
}
