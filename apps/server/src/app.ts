import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.ts';
import type { DatabaseHandle } from './db/database.ts';
import { healthRoutes } from './routes/health.ts';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    database: DatabaseHandle;
  }
}

/** Taille maximale d'un corps de requête : un import GeoJSON de réseau complet tient largement. */
export const BODY_LIMIT_BYTES = 8 * 1024 * 1024;

export interface BuildAppOptions {
  config: Config;
  database: DatabaseHandle;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: BODY_LIMIT_BYTES,
    // Nginx est le seul client direct : on lui fait confiance pour X-Forwarded-*.
    trustProxy: '127.0.0.1',
    disableRequestLogging: options.config.NODE_ENV === 'test',
  });

  app.decorate('config', options.config);
  app.decorate('database', options.database);

  // L'API ne sert que du JSON : la politique la plus fermée possible.
  // Les en-têtes des fichiers statiques sont posés par Nginx.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // Derrière Nginx, request.ip est l'IP réelle grâce à trustProxy.
    keyGenerator: (request) => request.ip,
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({ error: 'not_found', path: request.url });
  });

  healthRoutes(app);
  return app;
}
