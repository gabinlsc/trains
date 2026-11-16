import { z } from 'zod';

/**
 * Caractéristiques techniques d'un tronçon de voie. Ces énumérations sont
 * la source de vérité unique : le moteur, l'éditeur et l'API s'appuient
 * dessus, et les valeurs sont persistées telles quelles dans les sauvegardes
 * (ne jamais renommer une valeur sans migration de schéma).
 */

export const TRACK_COUNTS = [1, 2, 4] as const;
export const TrackCountSchema = z.union([z.literal(1), z.literal(2), z.literal(4)]);
export type TrackCount = z.infer<typeof TrackCountSchema>;

/** Écartement : normal (1 435 mm) ou métrique (Corse, Cerdagne, Blanc-Argent…). */
export const GaugeSchema = z.enum(['standard', 'metre']);
export type Gauge = z.infer<typeof GaugeSchema>;
export const GAUGE_MM: Readonly<Record<Gauge, number>> = { standard: 1435, metre: 1000 };

export const ElectrificationSchema = z.enum(['none', 'dc1500', 'ac25k']);
export type Electrification = z.infer<typeof ElectrificationSchema>;

/**
 * BAL : bloc automatique lumineux (lignes chargées) ; BAPR : bloc automatique
 * à permissivité restreinte (lignes peu circulées) ; ERTMS niveau 2 :
 * signalisation en cabine, la plus capacitaire et la plus chère.
 */
export const SignallingSchema = z.enum(['bapr', 'bal', 'ertms2']);
export type Signalling = z.infer<typeof SignallingSchema>;

/** Vitesse de conception en km/h. 30 km/h couvre les voies de service. */
export const MIN_DESIGN_SPEED_KMH = 30;
export const MAX_DESIGN_SPEED_KMH = 360;
export const DesignSpeedSchema = z
  .number()
  .int()
  .min(MIN_DESIGN_SPEED_KMH)
  .max(MAX_DESIGN_SPEED_KMH);

export const TrackSpecSchema = z.object({
  tracks: TrackCountSchema,
  gauge: GaugeSchema,
  electrification: ElectrificationSchema,
  signalling: SignallingSchema,
  designSpeedKmh: DesignSpeedSchema,
});
export type TrackSpec = z.infer<typeof TrackSpecSchema>;

/** Valeurs proposées par défaut pour un nouveau tronçon : une ligne classique moderne. */
export const DEFAULT_TRACK_SPEC: Readonly<TrackSpec> = Object.freeze({
  tracks: 2,
  gauge: 'standard',
  electrification: 'ac25k',
  signalling: 'bal',
  designSpeedKmh: 160,
});
