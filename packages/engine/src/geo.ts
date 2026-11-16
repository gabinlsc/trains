/**
 * Géodésie de base. Le moteur travaille en WGS84 (longitude, latitude en
 * degrés) et en mètres. À l'échelle d'un tronçon ferroviaire, la sphère
 * de rayon moyen suffit : l'écart avec l'ellipsoïde reste sous 0,5 %, bien
 * en deçà des autres incertitudes du modèle (coûts, demande).
 */

/** Position [longitude, latitude] en degrés, dans l'ordre GeoJSON. */
export type LngLat = readonly [lng: number, lat: number];

/** Rayon terrestre moyen (IUGG), en mètres. */
export const EARTH_RADIUS_M = 6_371_008.8;

const DEG = Math.PI / 180;

export function toRadians(deg: number): number {
  return deg * DEG;
}

/** Distance orthodromique (formule de haversine), en mètres. */
export function haversineDistance(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLng = (b[0] - a[0]) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLng / 2) ** 2;
  // min() protège asin des dépassements d'arrondi pour les antipodes.
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longueur cumulée d'une polyligne, en mètres. */
export function polylineLength(points: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(points[i - 1] as LngLat, points[i] as LngLat);
  }
  return total;
}

/** Cap initial de a vers b, en degrés dans [0, 360), 0 = nord, sens horaire. */
export function initialBearing(a: LngLat, b: LngLat): number {
  const φ1 = a[1] * DEG;
  const φ2 = b[1] * DEG;
  const Δλ = (b[0] - a[0]) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/**
 * Rayon du cercle passant par trois points consécutifs, en mètres
 * (cercle circonscrit, R = |ab|·|bc|·|ca| / 2|ab × ac|). Sert au contrôle
 * du rayon minimal en fonction de la vitesse de conception.
 *
 * Le calcul se fait dans une projection équirectangulaire locale centrée
 * sur le point médian : sur quelques kilomètres l'erreur est négligeable,
 * et un alignement droit donne un produit vectoriel exactement nul, ce que
 * la trigonométrie sphérique ne garantit pas à cause des arrondis.
 * Retourne `Infinity` pour des points alignés ou confondus.
 */
export function circumradius(a: LngLat, b: LngLat, c: LngLat): number {
  const mPerDegLat = EARTH_RADIUS_M * DEG;
  const mPerDegLng = mPerDegLat * Math.cos(b[1] * DEG);
  const ax = (a[0] - b[0]) * mPerDegLng;
  const ay = (a[1] - b[1]) * mPerDegLat;
  const cx = (c[0] - b[0]) * mPerDegLng;
  const cy = (c[1] - b[1]) * mPerDegLat;
  const ab = Math.hypot(ax, ay);
  const bc = Math.hypot(cx, cy);
  const ca = Math.hypot(cx - ax, cy - ay);
  const cross = Math.abs(ax * cy - ay * cx);
  // Seuil relatif : en dessous, la flèche est inférieure au micromètre.
  if (cross <= 1e-12 * ab * bc) return Number.POSITIVE_INFINITY;
  return (ab * bc * ca) / (2 * cross);
}
