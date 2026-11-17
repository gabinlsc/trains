import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeElevationGrid } from '@trains/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from '../test-utils.ts';

let dataDir: string;
let ctx: TestContext | undefined;

/** Publie une génération avec une grille 10 × 1 (100, 110, … 190 m d'ouest en est). */
function publish(version: string, withGrid = true): void {
  const dir = join(dataDir, 'data', version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ dataVersion: version }));
  if (withGrid) {
    const grid = encodeElevationGrid(
      { cols: 10, rows: 1, west: 2, north: 47.005, dlon: 0.01, dlat: 0.01 },
      Int16Array.from({ length: 10 }, (_, i) => 100 + i * 10),
    );
    writeFileSync(join(dir, 'altitude.bin'), grid);
  }
  rmSync(join(dataDir, 'data', 'current'), { force: true });
  symlinkSync(version, join(dataDir, 'data', 'current'));
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'trains-elev-'));
});
afterEach(async () => {
  await ctx?.app.close();
  await ctx?.database.close();
  ctx = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

const profile = (points: unknown, step?: number) =>
  ctx?.app.inject({
    method: 'POST',
    url: '/api/elevation/profile',
    payload: { points, ...(step ? { step } : {}) },
  });

describe('POST /api/elevation/profile', () => {
  it('échantillonne le terrain le long du tracé', async () => {
    publish('2026.01.1');
    ctx = await createTestApp({ DATA_DIR: dataDir });
    const res = await profile(
      [
        [2.005, 47.0],
        [2.085, 47.0],
      ],
      1000,
    );
    expect(res?.statusCode).toBe(200);
    const body = res?.json<{ step: number; distance: number[]; elevation: (number | null)[] }>();
    expect(body?.step).toBe(1000);
    expect(body?.distance[1]).toBe(1000);
    expect(body?.elevation[0]).toBe(100);
    expect(body?.elevation.at(-1)).toBe(180);
    expect(res?.headers['cache-control']).toBe('no-store');
  });

  it('suit une nouvelle génération de données', async () => {
    publish('2026.01.1');
    ctx = await createTestApp({ DATA_DIR: dataDir });
    await profile([
      [2.005, 47.0],
      [2.015, 47.0],
    ]);
    publish('2026.02.1', false);
    const res = await profile([
      [2.005, 47.0],
      [2.015, 47.0],
    ]);
    expect(res?.statusCode).toBe(503);
  });

  it('répond 503 sans données publiées', async () => {
    ctx = await createTestApp({ DATA_DIR: dataDir });
    const res = await profile([
      [2.005, 47.0],
      [2.015, 47.0],
    ]);
    expect(res?.statusCode).toBe(503);
    expect(res?.json()).toEqual({ error: 'elevation_unavailable' });
  });

  it('valide le corps de la requête', async () => {
    publish('2026.01.1');
    ctx = await createTestApp({ DATA_DIR: dataDir });
    expect((await profile([[2, 47]]))?.statusCode).toBe(400);
    expect(
      (
        await profile([
          [200, 47],
          [2, 47],
        ])
      )?.statusCode,
    ).toBe(400);
    expect(
      (
        await profile(
          [
            [2, 47],
            [2.1, 47],
          ],
          5,
        )
      )?.statusCode,
    ).toBe(400);
  });

  it('refuse un profil trop long', async () => {
    publish('2026.01.1');
    ctx = await createTestApp({ DATA_DIR: dataDir });
    const res = await profile(
      [
        [2.0, 47.0],
        [8.0, 47.0],
      ],
      25,
    );
    expect(res?.statusCode).toBe(413);
  });
});
