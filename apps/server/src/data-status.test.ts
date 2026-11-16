import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataStatus } from './data-status.ts';

describe('readDataStatus', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'trains-data-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function publish(content: string): void {
    const versionDir = join(dir, 'data', '2026.11.1');
    mkdirSync(versionDir, { recursive: true });
    writeFileSync(join(versionDir, 'manifest.json'), content);
    symlinkSync(versionDir, join(dir, 'data', 'current'));
  }

  it('signale des données absentes', async () => {
    expect(await readDataStatus(dir)).toEqual({ status: 'missing' });
  });

  it('lit la version publiée via le lien current', async () => {
    publish(JSON.stringify({ dataVersion: '2026.11.1', sources: [] }));
    expect(await readDataStatus(dir)).toEqual({ status: 'ok', version: '2026.11.1' });
  });

  it('détecte un manifeste mal formé', async () => {
    publish('{ pas du json');
    expect(await readDataStatus(dir)).toMatchObject({ status: 'invalid' });
  });

  it('détecte un manifeste sans version', async () => {
    publish(JSON.stringify({ sources: [] }));
    expect(await readDataStatus(dir)).toMatchObject({ status: 'invalid' });
  });

  it('détecte un manifeste illisible', async () => {
    mkdirSync(join(dir, 'data', 'current', 'manifest.json'), { recursive: true });
    expect(await readDataStatus(dir)).toEqual({
      status: 'invalid',
      reason: 'manifeste illisible',
    });
  });
});
