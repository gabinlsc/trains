import { afterEach, describe, expect, it } from 'vitest';
import { BODY_LIMIT_BYTES } from './app.ts';
import { createTestApp, type TestContext } from './test-utils.ts';

let ctx: TestContext | undefined;

afterEach(async () => {
  await ctx?.app.close();
  await ctx?.database.close();
  ctx = undefined;
});

describe('GET /api/health', () => {
  it('répond « degraded » quand la base va bien mais que les données manquent', async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toMatchObject({
      status: 'degraded',
      version: '0.0.0-test',
      commit: 'test',
      database: { status: 'ok', pendingMigrations: [] },
      data: { status: 'missing' },
    });
  });

  it('signale les migrations en attente', async () => {
    ctx = await createTestApp({}, { migrate: false });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: 'error',
      database: { status: 'pending-migrations', pendingMigrations: ['0001_init'] },
    });
  });

  it('répond 503 si la base ne répond plus', async () => {
    ctx = await createTestApp();
    ctx.database.sqlite.close();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'error', database: { status: 'down' } });
    // La connexion est déjà fermée : on évite une double fermeture dans afterEach.
    await ctx.app.close();
    ctx = undefined;
  });
});

describe('sécurité HTTP', () => {
  it('pose des en-têtes stricts sur les réponses de l’API', async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(res.headers['strict-transport-security']).toContain('max-age=63072000');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['permissions-policy']).toContain('camera=()');
  });

  it('renvoie un 404 JSON pour une route inconnue', async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/inconnue' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', path: '/api/inconnue' });
  });

  it('borne la taille des corps de requête', async () => {
    ctx = await createTestApp(
      {},
      {
        extend: (app) => {
          app.post('/api/echo', () => ({ ok: true }));
        },
      },
    );
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/echo',
      headers: { 'content-type': 'application/json' },
      payload: `"${'x'.repeat(BODY_LIMIT_BYTES + 1)}"`,
    });
    expect(res.statusCode).toBe(413);
  });
});
