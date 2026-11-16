import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRACK_SPEC,
  GAUGE_MM,
  MAX_DESIGN_SPEED_KMH,
  TrackSpecSchema,
} from './infrastructure.ts';

describe('TrackSpecSchema', () => {
  it('accepte la spécification par défaut', () => {
    expect(TrackSpecSchema.parse(DEFAULT_TRACK_SPEC)).toEqual(DEFAULT_TRACK_SPEC);
  });

  it('refuse un nombre de voies non prévu', () => {
    expect(TrackSpecSchema.safeParse({ ...DEFAULT_TRACK_SPEC, tracks: 3 }).success).toBe(false);
  });

  it('refuse une vitesse hors bornes ou non entière', () => {
    for (const designSpeedKmh of [0, 29, MAX_DESIGN_SPEED_KMH + 1, 160.5]) {
      expect(TrackSpecSchema.safeParse({ ...DEFAULT_TRACK_SPEC, designSpeedKmh }).success).toBe(
        false,
      );
    }
  });

  it('refuse une électrification inconnue', () => {
    expect(
      TrackSpecSchema.safeParse({ ...DEFAULT_TRACK_SPEC, electrification: 'ac15k' }).success,
    ).toBe(false);
  });

  it('expose les écartements en millimètres', () => {
    expect(GAUGE_MM.standard).toBe(1435);
    expect(GAUGE_MM.metre).toBe(1000);
  });

  it('fige la spécification par défaut', () => {
    expect(Object.isFrozen(DEFAULT_TRACK_SPEC)).toBe(true);
  });
});
