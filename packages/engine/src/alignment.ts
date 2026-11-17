/**
 * Géométrie du tracé : rayons de courbure admissibles selon la vitesse,
 * raccordement des alignements par des arcs de cercle, et contrôles de
 * courbure et de déclivité.
 *
 * Les calculs se font dans une projection plane locale (équirectangulaire
 * autour du sommet traité) : à l'échelle d'une courbe, l'erreur est
 * négligeable devant la précision du tracé à la souris.
 */
import { EARTH_RADIUS_M, type LngLat } from './geo.ts';

/**
 * Rayons minimaux indicatifs (m) selon la vitesse de conception (km/h),
 * d'après les ordres de grandeur du référentiel français : au-delà de
 * 300 km/h, les LGV retiennent environ 7 000 m.
 */
const RADIUS_TABLE: readonly (readonly [number, number])[] = [
  [100, 400],
  [160, 1000],
  [220, 2500],
  [320, 7000],
];

/**
 * Rayon minimal pour une vitesse donnée, par interpolation linéaire de la
 * table. En dehors, on prolonge en V² (accélération transversale constante),
 * calé sur la borne la plus proche.
 */
export function minRadiusForSpeed(speedKmh: number): number {
  const first = RADIUS_TABLE[0] as readonly [number, number];
  const last = RADIUS_TABLE[RADIUS_TABLE.length - 1] as readonly [number, number];
  if (speedKmh <= first[0]) return first[1] * (speedKmh / first[0]) ** 2;
  if (speedKmh >= last[0]) return last[1] * (speedKmh / last[0]) ** 2;
  for (let i = 1; i < RADIUS_TABLE.length; i++) {
    const [v1, r1] = RADIUS_TABLE[i - 1] as readonly [number, number];
    const [v2, r2] = RADIUS_TABLE[i] as readonly [number, number];
    if (speedKmh <= v2) return r1 + ((speedKmh - v1) / (v2 - v1)) * (r2 - r1);
  }
  return last[1];
}

/** Vitesse maximale (km/h) autorisée par un rayon : réciproque de la table. */
export function maxSpeedForRadius(radiusM: number): number {
  if (!Number.isFinite(radiusM)) return Infinity;
  const first = RADIUS_TABLE[0] as readonly [number, number];
  const last = RADIUS_TABLE[RADIUS_TABLE.length - 1] as readonly [number, number];
  if (radiusM <= first[1]) return first[0] * Math.sqrt(radiusM / first[1]);
  if (radiusM >= last[1]) return last[0] * Math.sqrt(radiusM / last[1]);
  for (let i = 1; i < RADIUS_TABLE.length; i++) {
    const [v1, r1] = RADIUS_TABLE[i - 1] as readonly [number, number];
    const [v2, r2] = RADIUS_TABLE[i] as readonly [number, number];
    if (radiusM <= r2) return v1 + ((radiusM - r1) / (r2 - r1)) * (v2 - v1);
  }
  return last[0];
}

// --- Projection locale -----------------------------------------------------------

interface Frame {
  toXY: (p: LngLat) => [number, number];
  toLngLat: (xy: readonly [number, number]) => LngLat;
}

function localFrame(origin: LngLat): Frame {
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const mPerDegLng = mPerDegLat * Math.cos((origin[1] * Math.PI) / 180);
  return {
    toXY: (p) => [(p[0] - origin[0]) * mPerDegLng, (p[1] - origin[1]) * mPerDegLat],
    toLngLat: ([x, y]) => [origin[0] + x / mPerDegLng, origin[1] + y / mPerDegLat],
  };
}

// --- Raccordement par arcs -------------------------------------------------------

export interface SmoothOptions {
  /** Rayon des arcs de raccordement (m). */
  radius: number;
  /** Écart angulaire maximal entre deux points d'un arc (radians) : finesse du dessin. */
  maxStepRad?: number;
}

/**
 * Remplace chaque sommet intérieur par un arc de cercle tangent aux deux
 * alignements. Si un alignement est trop court pour contenir les deux
 * tangentes voisines, le rayon est réduit localement : le contrôle de
 * courbure le signalera alors.
 */
export function smoothAlignment(points: readonly LngLat[], options: SmoothOptions): LngLat[] {
  if (points.length < 3) return points.map((p) => [p[0], p[1]] as LngLat);
  const { radius, maxStepRad = 0.02 } = options;
  const first = points[0] as LngLat;
  const out: LngLat[] = [[first[0], first[1]]];
  // Longueur disponible de chaque côté d'un sommet : la moitié de chaque alignement,
  // pour que deux arcs voisins ne se chevauchent jamais.
  for (let i = 1; i < points.length - 1; i++) {
    const vertex = points[i] as LngLat;
    const frame = localFrame(vertex);
    const a = frame.toXY(points[i - 1] as LngLat);
    const c = frame.toXY(points[i + 1] as LngLat);
    const la = Math.hypot(a[0], a[1]);
    const lc = Math.hypot(c[0], c[1]);
    if (la === 0 || lc === 0) continue;
    const ua: [number, number] = [a[0] / la, a[1] / la];
    const uc: [number, number] = [c[0] / lc, c[1] / lc];
    // Angle intérieur au sommet ; la déviation est son supplément.
    const cos = Math.max(-1, Math.min(1, ua[0] * uc[0] + ua[1] * uc[1]));
    const interior = Math.acos(cos);
    const deflection = Math.PI - interior;
    if (deflection < 1e-6) {
      out.push([vertex[0], vertex[1]]);
      continue;
    }
    // Distance du sommet aux points de tangence : T = R · tan(déviation / 2).
    const available = Math.min(la, lc) / 2;
    const r = Math.min(radius, available / Math.tan(deflection / 2));
    const t = r * Math.tan(deflection / 2);
    const start: [number, number] = [ua[0] * t, ua[1] * t];
    const end: [number, number] = [uc[0] * t, uc[1] * t];
    // Centre sur la bissectrice, à R / sin(intérieur / 2) du sommet.
    const bis: [number, number] = [ua[0] + uc[0], ua[1] + uc[1]];
    const lb = Math.hypot(bis[0], bis[1]);
    const d = r / Math.sin(interior / 2);
    const center: [number, number] = [(bis[0] / lb) * d, (bis[1] / lb) * d];
    const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
    let a1 = Math.atan2(end[1] - center[1], end[0] - center[0]);
    // Parcours de l'arc le plus court (celui qui longe le sommet).
    while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
    while (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / maxStepRad));
    for (let k = 0; k <= steps; k++) {
      const angle = a0 + ((a1 - a0) * k) / steps;
      out.push(frame.toLngLat([center[0] + r * Math.cos(angle), center[1] + r * Math.sin(angle)]));
    }
  }
  const lastPoint = points[points.length - 1] as LngLat;
  out.push([lastPoint[0], lastPoint[1]]);
  return out;
}

// --- Contrôles ----------------------------------------------------------------

export interface CurveIssue {
  /** Index du sommet dans la polyligne. */
  index: number;
  /** Rayon estimé (m) ; 0 pour un angle vif. */
  radius: number;
  required: number;
}

/**
 * Au-delà de cette déviation en un seul sommet (≈ 3°), le tracé fait un
 * angle vif : aucune courbe n'est dessinée, quel que soit l'espacement des
 * points. Les arcs du lissage changent de direction d'au plus 1,15° par point.
 */
export const MAX_VERTEX_DEFLECTION_RAD = 0.05;

/**
 * Sommets dont le rayon local est inférieur au rayon exigé. Le rayon est
 * estimé à partir de la plus courte des deux cordes c et de la déviation δ
 * au sommet : R = c / (2 sin(δ/2)), exact pour des points sur un cercle.
 * Les points trop proches (< 1 m) sont ignorés.
 */
export function checkCurvature(
  points: readonly LngLat[],
  requiredRadius: number,
  maxDeflection = MAX_VERTEX_DEFLECTION_RAD,
): CurveIssue[] {
  const issues: CurveIssue[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const vertex = points[i] as LngLat;
    const frame = localFrame(vertex);
    const a = frame.toXY(points[i - 1] as LngLat);
    const c = frame.toXY(points[i + 1] as LngLat);
    const la = Math.hypot(a[0], a[1]);
    const lc = Math.hypot(c[0], c[1]);
    if (la < 1 || lc < 1) continue;
    const cos = Math.max(-1, Math.min(1, (a[0] * c[0] + a[1] * c[1]) / (la * lc)));
    const deflection = Math.PI - Math.acos(cos);
    if (deflection < 1e-9) continue;
    const radius =
      deflection > maxDeflection ? 0 : Math.min(la, lc) / (2 * Math.sin(deflection / 2));
    // Tolérance de 0,5 % : la discrétisation des arcs approche le rayon par défaut.
    if (radius < requiredRadius * 0.995)
      issues.push({ index: i, radius, required: requiredRadius });
  }
  return issues;
}

/** Catégorie de déclivité, du plus courant au plus exceptionnel. */
export type GradeClass = 'ok' | 'steep' | 'mountain' | 'rack';

/**
 * Déclivités maximales indicatives (‰) : 35 en ligne à grande vitesse
 * (≥ 250 km/h), 25 en ligne classique ; jusqu'à 70 en adhérence pour une
 * ligne de montagne ; au-delà, crémaillère.
 */
export function gradeLimits(designSpeedKmh: number): { normal: number; mountain: number } {
  return { normal: designSpeedKmh >= 250 ? 35 : 25, mountain: 70 };
}

export function classifyGrade(gradePermille: number, designSpeedKmh: number): GradeClass {
  const g = Math.abs(gradePermille);
  const limits = gradeLimits(designSpeedKmh);
  if (g <= limits.normal) return 'ok';
  if (g <= limits.mountain * 0.6) return 'steep';
  if (g <= limits.mountain) return 'mountain';
  return 'rack';
}

/**
 * Déclivité maximale (‰) d'un profil en long, mesurée sur une base glissante
 * (par défaut 1 km) : une rampe se juge sur une distance, pas d'un point de
 * la grille d'altitude au suivant.
 */
export function maxGrade(
  profile: readonly { distance: number; elevation: number }[],
  baseM = 1000,
): number {
  let max = 0;
  let j = 0;
  for (const a of profile) {
    while (
      j < profile.length &&
      (profile[j] as { distance: number }).distance - a.distance < baseM
    ) {
      j++;
    }
    const b = profile[Math.min(j, profile.length - 1)] as { distance: number; elevation: number };
    const run = b.distance - a.distance;
    if (run <= 0) continue;
    max = Math.max(max, (Math.abs(b.elevation - a.elevation) / run) * 1000);
  }
  return max;
}
