import { sampleProfile } from '@trains/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ElevationStore } from '../elevation-store.ts';

const BodySchema = z.object({
  points: z
    .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
    .min(2)
    .max(5000),
  /** Pas d'échantillonnage (m) ; borné pour limiter la taille des réponses. */
  step: z.number().min(25).max(1000).default(100),
});

/** Nombre maximal d'échantillons par réponse (≈ 500 km au pas de 100 m). */
export const MAX_SAMPLES = 5000;

const round = (value: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

/**
 * POST /api/elevation/profile — altitude du terrain le long d'un tracé.
 * La grille (48 Mo) reste sur le serveur : le navigateur ne reçoit que les
 * échantillons du tronçon affiché.
 */
export function elevationRoutes(app: FastifyInstance): void {
  const store = new ElevationStore(app.config.DATA_DIR);

  app.post(
    '/api/elevation/profile',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = BodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues.length });
      }
      const grid = await store.get();
      if (!grid) return reply.code(503).send({ error: 'elevation_unavailable' });

      const samples = sampleProfile(parsed.data.points, grid, parsed.data.step);
      if (samples.length > MAX_SAMPLES) {
        return reply.code(413).send({ error: 'profile_too_long', maxSamples: MAX_SAMPLES });
      }
      void reply.header('cache-control', 'no-store');
      return {
        step: parsed.data.step,
        distance: samples.map((s) => round(s.distance, 1)),
        elevation: samples.map((s) => (s.elevation === null ? null : round(s.elevation, 1))),
      };
    },
  );
}
