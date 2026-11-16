import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { loadConfig, type Config } from './config.ts';
import { openDatabase, type DatabaseHandle } from './db/database.ts';
import { migrateToLatest } from './db/migrate.ts';

export interface TestContext {
  app: FastifyInstance;
  database: DatabaseHandle;
  config: Config;
}

/** Application complète sur une base SQLite en mémoire, déjà migrée. */
export async function createTestApp(
  overrides: Partial<Record<keyof Config, string>> = {},
  { migrate = true, extend }: { migrate?: boolean; extend?: (app: FastifyInstance) => void } = {},
): Promise<TestContext> {
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: '/nonexistent', ...overrides });
  const database = openDatabase(':memory:');
  if (migrate) await migrateToLatest(database.db);
  const app = await buildApp({ config, database });
  // Permet aux tests d'ajouter des routes d'essai avant le démarrage du serveur.
  extend?.(app);
  await app.ready();
  return { app, database, config };
}
