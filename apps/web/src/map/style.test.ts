import { describe, expect, it } from 'vitest';
import { BASEMAP_ATTRIBUTION, BASEMAP_SOURCE, buildStyle, flavorFor } from './style.ts';

describe('style du fond de carte', () => {
  it('pointe vers les ressources auto-hébergées', () => {
    const style = buildStyle('light', 'https://trains.glsc.fr');
    expect(style.glyphs).toBe('https://trains.glsc.fr/tiles/assets/fonts/{fontstack}/{range}.pbf');
    expect(style.sprite).toBe('https://trains.glsc.fr/tiles/assets/sprites/v4/light');
    expect(style.sources[BASEMAP_SOURCE]).toMatchObject({
      type: 'vector',
      url: 'pmtiles://https://trains.glsc.fr/tiles/france.pmtiles',
    });
  });

  it('n’appelle aucun service tiers', () => {
    const json = JSON.stringify(buildStyle('dark', 'https://trains.glsc.fr'));
    const hosts = new Set([...json.matchAll(/https?:\/\/([^/"\\]+)/g)].map((m) => m[1]));
    expect([...hosts]).toEqual(['trains.glsc.fr']);
  });

  it('porte les mentions OpenStreetMap et Protomaps', () => {
    expect(BASEMAP_ATTRIBUTION).toContain('contributeurs OpenStreetMap');
    expect(BASEMAP_ATTRIBUTION).toContain('Protomaps');
  });

  it('affiche les libellés en français et change de sprite avec le thème', () => {
    const dark = buildStyle('dark', 'http://localhost:4173');
    expect(dark.sprite).toBe('http://localhost:4173/tiles/assets/sprites/v4/dark');
    expect(JSON.stringify(dark.layers)).toContain('name:fr');
    expect(dark.layers.length).toBeGreaterThan(50);
  });

  it('garde des fonds contrastés entre les deux thèmes', () => {
    expect(flavorFor('light').earth).toBe('#f6f4ef');
    expect(flavorFor('dark').earth).toBe('#151a21');
    expect(flavorFor('light').landcover?.forest).toBeDefined();
  });
});
