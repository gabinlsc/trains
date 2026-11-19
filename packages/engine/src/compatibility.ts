/**
 * Compatibilité entre un matériel roulant et l'infrastructure : écartement,
 * alimentation et vitesse effectivement permise.
 */
import { acceptsPower, type RollingStock, type TrackSpec } from '@trains/shared';

/**
 * Sans signalisation en cabine, la signalisation latérale limite la vitesse
 * à 220 km/h : au-delà, le conducteur ne peut plus lire les signaux.
 */
export const LINESIDE_SIGNAL_LIMIT_KMH = 220;

export type CompatibilityIssue = 'gauge' | 'power';

export interface Compatibility {
  /** Le matériel peut-il circuler ? */
  ok: boolean;
  issues: CompatibilityIssue[];
  /** Vitesse permise : la plus faible du matériel, de la voie et de la signalisation. */
  speedKmh: number;
  /** Vrai si la signalisation, et non la voie ou le train, fixe la vitesse. */
  limitedBySignalling: boolean;
}

export function compatibility(stock: RollingStock, spec: TrackSpec): Compatibility {
  const issues: CompatibilityIssue[] = [];
  if (stock.gauge !== spec.gauge) issues.push('gauge');
  if (!acceptsPower(stock, spec.electrification)) issues.push('power');
  const physical = Math.min(stock.maxSpeedKmh, spec.designSpeedKmh);
  const signalled =
    spec.signalling === 'ertms2' ? physical : Math.min(physical, LINESIDE_SIGNAL_LIMIT_KMH);
  return {
    ok: issues.length === 0,
    issues,
    speedKmh: issues.length === 0 ? signalled : 0,
    limitedBySignalling: signalled < physical,
  };
}

/** Compatibilité sur un itinéraire : tous ses tronçons doivent l'être. */
export function routeCompatibility(
  stock: RollingStock,
  specs: readonly TrackSpec[],
): { ok: boolean; issues: CompatibilityIssue[]; blocking: number[] } {
  const issues = new Set<CompatibilityIssue>();
  const blocking: number[] = [];
  specs.forEach((spec, index) => {
    const result = compatibility(stock, spec);
    if (!result.ok) {
      blocking.push(index);
      for (const issue of result.issues) issues.add(issue);
    }
  });
  return { ok: blocking.length === 0, issues: [...issues], blocking };
}
