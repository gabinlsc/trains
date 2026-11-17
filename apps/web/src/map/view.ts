import { DATA_BBOX } from '@trains/shared';
import type { LngLatBoundsLike } from 'maplibre-gl';

/** Vue initiale : la métropole et la Corse en entier. */
export const FRANCE_BOUNDS: LngLatBoundsLike = [
  [-5.2, 41.3],
  [9.6, 51.2],
];

/**
 * Le fond de carte s'arrête à l'emprise des données. Un cadrage strict sur
 * cette emprise couperait le nord ou la Corse sur un écran large : on laisse
 * une marge, où seul le fond uni apparaît, lu comme « hors zone ».
 */
export const MAX_BOUNDS: LngLatBoundsLike = [
  [DATA_BBOX.west - 4, DATA_BBOX.south - 1],
  [DATA_BBOX.east + 4, DATA_BBOX.north + 1],
];

/** Le fond de carte s'arrête au zoom 13 ; MapLibre suréchantillonne au-delà. */
export const MIN_ZOOM = 4;
export const MAX_ZOOM = 16;
