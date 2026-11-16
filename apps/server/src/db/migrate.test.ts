import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, pingDatabase, type DatabaseHandle } from './database.ts';
import { migrateToLatest, pendingMigrations } from './migrate.ts';

let handle: DatabaseHandle | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

describe('migrations', () => {
  it('applique les migrations puis devient idempotent', async () => {
    handle = openDatabase(':memory:');
    expect(await pendingMigrations(handle.db)).toEqual(['0001_init']);
    expect((await migrateToLatest(handle.db)).applied).toEqual(['0001_init']);
    expect((await migrateToLatest(handle.db)).applied).toEqual([]);
    expect(await pendingMigrations(handle.db)).toEqual([]);
  });

  it('crée une table app_meta exploitable', async () => {
    handle = openDatabase(':memory:');
    await migrateToLatest(handle.db);
    await handle.db.insertInto('app_meta').values({ key: 'k', value: 'v' }).execute();
    const row = await handle.db
      .selectFrom('app_meta')
      .selectAll()
      .where('key', '=', 'k')
      .executeTakeFirstOrThrow();
    expect(row.value).toBe('v');
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('active WAL et les clés étrangères sur un fichier', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trains-db-'));
    try {
      handle = openDatabase(join(dir, 'sous-dossier', 'test.sqlite'));
      expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(pingDatabase(handle.sqlite)).toBe(true);
      await handle.close();
      handle = undefined;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
