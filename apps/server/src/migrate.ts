// Point d'entrée utilisé par deploy.sh : applique les migrations puis quitte.
import { loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { migrateToLatest } from './db/migrate.ts';

const config = loadConfig();
const database = openDatabase(config.DATABASE_PATH);
try {
  const { applied } = await migrateToLatest(database.db);
  process.stdout.write(
    applied.length > 0 ? `Migrations appliquées : ${applied.join(', ')}\n` : 'Base déjà à jour.\n',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await database.close();
}
