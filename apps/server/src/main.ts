import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { migrateToLatest } from './db/migrate.ts';

const config = loadConfig();
const database = openDatabase(config.DATABASE_PATH);

// deploy.sh applique les migrations (après sauvegarde) avant le redémarrage ;
// les rejouer ici est sans effet en production et pratique en développement.
await migrateToLatest(database.db);

// Logs JSON sur la sortie standard : journald les collecte via systemd.
const app = await buildApp({
  config,
  database,
  logger: { level: config.LOG_LEVEL, base: { service: 'trains' } },
});

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'arrêt demandé');
  try {
    await app.close();
    await database.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'arrêt en erreur');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
