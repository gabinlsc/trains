import type { FastifyInstance } from 'fastify';
import { buildInfo } from '../build-info.ts';
import { readDataStatus } from '../data-status.ts';
import { pingDatabase } from '../db/database.ts';
import { pendingMigrations } from '../db/migrate.ts';

/**
 * GET /api/health — consommé par deploy.sh (rollback automatique si KO) et
 * par la supervision. Répond 200 tant que la base répond : l'absence de
 * données géographiques dégrade le service sans le rendre indisponible.
 */
export function healthRoutes(app: FastifyInstance): void {
  app.get('/api/health', { config: { rateLimit: false } }, async (_request, reply) => {
    const dbUp = pingDatabase(app.database.sqlite);
    const pending = dbUp ? await pendingMigrations(app.database.db) : [];
    const data = await readDataStatus(app.config.DATA_DIR);
    const dbStatus = !dbUp ? 'down' : pending.length > 0 ? 'pending-migrations' : 'ok';
    const status = dbStatus === 'ok' ? (data.status === 'ok' ? 'ok' : 'degraded') : 'error';

    void reply.code(status === 'error' ? 503 : 200).header('cache-control', 'no-store');
    return {
      status,
      version: buildInfo.version,
      commit: buildInfo.commit,
      uptimeSeconds: Math.round(process.uptime()),
      database: { status: dbStatus, pendingMigrations: pending },
      data,
    };
  });
}
