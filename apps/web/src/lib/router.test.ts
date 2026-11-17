import { describe, expect, it } from 'vitest';
import { normalisePath, ROUTES } from './router.svelte.ts';

describe('normalisePath', () => {
  it('supprime la barre finale, la requête et l’ancre', () => {
    expect(normalisePath('/carte/')).toBe('/carte');
    expect(normalisePath('/carte?x=1#y')).toBe('/carte');
    expect(normalisePath('/')).toBe('/');
    expect(normalisePath('')).toBe('/');
    expect(normalisePath('//')).toBe('/');
  });

  it('expose les routes connues', () => {
    expect(ROUTES).toEqual({ home: '/', map: '/carte' });
  });
});
