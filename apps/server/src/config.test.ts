import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('applique les valeurs par défaut', () => {
    const config = loadConfig({});
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3070);
    expect(config.HOST).toBe('127.0.0.1');
  });

  it('convertit le port en nombre', () => {
    expect(loadConfig({ PORT: '3071' }).PORT).toBe(3071);
  });

  it('refuse un port invalide avec un message lisible', () => {
    expect(() => loadConfig({ PORT: '99999' })).toThrow(/PORT/);
  });

  it('exige un secret de session robuste en production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'court' })).toThrow(
      /SESSION_SECRET/,
    );
    expect(loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'a'.repeat(64) }).NODE_ENV).toBe(
      'production',
    );
  });

  it('refuse une URL publique mal formée', () => {
    expect(() => loadConfig({ PUBLIC_URL: 'pas une url' })).toThrow(/PUBLIC_URL/);
  });
});
