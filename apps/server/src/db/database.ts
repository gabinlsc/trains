import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DatabaseSchema } from './schema.ts';

export interface DatabaseHandle {
  db: Kysely<DatabaseSchema>;
  sqlite: Database.Database;
  close: () => Promise<void>;
}

/**
 * Ouvre la base SQLite. `:memory:` est accepté pour les tests.
 *
 * WAL permet des lectures concurrentes pendant une écriture ; busy_timeout
 * absorbe les verrous brefs (sauvegarde `.backup` lancée par deploy.sh).
 */
export function openDatabase(path: string): DatabaseHandle {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = new Kysely<DatabaseSchema>({ dialect: new SqliteDialect({ database: sqlite }) });
  return {
    db,
    sqlite,
    // Kysely ferme aussi la connexion better-sqlite3 sous-jacente.
    close: () => db.destroy(),
  };
}

/** Sonde légère utilisée par /api/health. */
export function pingDatabase(sqlite: Database.Database): boolean {
  try {
    const row = sqlite.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    return row?.ok === 1;
  } catch {
    return false;
  }
}
