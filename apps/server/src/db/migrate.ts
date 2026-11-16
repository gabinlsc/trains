import type { Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import * as m0001 from './migrations/0001_init.ts';

/**
 * Migrations référencées statiquement plutôt que lues sur disque : le
 * serveur est livré sous forme de bundle, sans arborescence de fichiers.
 * L'ordre alphabétique des clés fait foi.
 */
const migrations: Record<string, Migration> = {
  '0001_init': m0001,
};

const provider: MigrationProvider = {
  getMigrations: () => Promise.resolve(migrations),
};

export interface MigrationOutcome {
  applied: string[];
}

export async function migrateToLatest<DB>(db: Kysely<DB>): Promise<MigrationOutcome> {
  const migrator = new Migrator({ db, provider });
  const { error, results = [] } = await migrator.migrateToLatest();
  const failed = results.find((r) => r.status === 'Error');
  if (error !== undefined || failed) {
    const name = failed ? ` (${failed.migrationName})` : '';
    throw new Error(`Échec de la migration${name}`, { cause: error });
  }
  return { applied: results.map((r) => r.migrationName) };
}

export async function pendingMigrations<DB>(db: Kysely<DB>): Promise<string[]> {
  const migrator = new Migrator({ db, provider });
  const all = await migrator.getMigrations();
  return all.filter((m) => m.executedAt === undefined).map((m) => m.name);
}
