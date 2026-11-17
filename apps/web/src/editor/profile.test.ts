import { describe, expect, it } from 'vitest';
import { analyseProfile, fetchProfile, type TerrainProfile } from './profile.ts';

/** Plaine de 20 km avec une crête de 150 m au milieu, au pas de 100 m. */
const PROFILE: TerrainProfile = {
  step: 100,
  distance: Array.from({ length: 201 }, (_, i) => i * 100),
  elevation: Array.from({ length: 201 }, (_, i) => {
    const d = i * 100;
    return d > 8000 && d < 12_000 ? 200 + 150 * Math.sin(((d - 8000) / 4000) * Math.PI) : 200;
  }),
};

describe('analyseProfile', () => {
  it('propose un tunnel sous la crête et respecte la limite de la vitesse', () => {
    const a = analyseProfile(PROFILE, 160);
    expect(a.limit).toBe(25);
    expect(a.length).toBe(20_000);
    expect(a.trackGrade).toBeLessThanOrEqual(25 + 1e-6);
    expect(a.terrainGrade).toBeGreaterThan(100);
    expect(a.structures.map((s) => s.kind)).toEqual(['tunnel']);
    expect(a.tunnelLength).toBeGreaterThan(1000);
    expect(a.viaductLength).toBe(0);
    expect(a.maxElevation).toBeCloseTo(350, 0);
  });

  it('admet une rampe plus forte à grande vitesse', () => {
    expect(analyseProfile(PROFILE, 320).limit).toBe(35);
  });

  it('comble les points hors grille', () => {
    const a = analyseProfile(
      { step: 100, distance: [0, 100, 200], elevation: [null, 120, null] },
      160,
    );
    expect(a.terrain).toEqual([120, 120, 120]);
  });
});

describe('fetchProfile', () => {
  it('envoie le tracé et renvoie la réponse', async () => {
    let body = '';
    const fetchImpl = ((_url: string, init?: RequestInit) => {
      body = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(new Response(JSON.stringify(PROFILE)));
    }) as unknown as typeof fetch;
    const result = await fetchProfile(
      [
        [2, 47],
        [2.1, 47],
      ],
      undefined,
      fetchImpl,
    );
    expect(JSON.parse(body)).toEqual({
      points: [
        [2, 47],
        [2.1, 47],
      ],
    });
    expect(result.step).toBe(100);
  });

  it('signale une API indisponible', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('', { status: 503 }))) as unknown as typeof fetch;
    await expect(
      fetchProfile(
        [
          [2, 47],
          [2.1, 47],
        ],
        undefined,
        fetchImpl,
      ),
    ).rejects.toThrow(/HTTP 503/);
  });
});
