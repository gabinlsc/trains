import { describe, expect, it } from 'vitest';
import { t } from '../../i18n/index.ts';
import { BASEMAP_SOURCE } from '../style.ts';
import { DATA_ATTRIBUTIONS, dataKeyOf, GROUPS, OVERLAYS, sourceId } from './catalog.ts';
import { RELIEF_CONTOURS_SOURCE, RELIEF_DEM_SOURCE } from './relief.ts';

describe('catalogue des calques', () => {
  it('a des identifiants de calques et de couches uniques', () => {
    const ids = OVERLAYS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    const layerIds = OVERLAYS.flatMap((o) => o.layers('light').map((l) => l.id));
    expect(new Set(layerIds).size).toBe(layerIds.length);
  });

  it('relie chaque couche à une source existante', () => {
    const sources = new Set([
      BASEMAP_SOURCE,
      RELIEF_DEM_SOURCE,
      RELIEF_CONTOURS_SOURCE,
      ...OVERLAYS.filter((o) => o.load).map((o) => sourceId(dataKeyOf(o))),
    ]);
    for (const overlay of OVERLAYS) {
      for (const layer of overlay.layers('dark')) {
        expect(sources.has((layer as { source: string }).source)).toBe(true);
      }
    }
  });

  it('partage le fichier des lignes entre réseau actuel et lignes fermées', () => {
    const rfn = OVERLAYS.filter((o) => dataKeyOf(o) === 'rfn').map((o) => o.id);
    expect(rfn.sort()).toEqual(['closed-lines', 'real-network']);
  });

  it('a un libellé traduit et un groupe connu pour chaque calque', () => {
    const groups = new Set(GROUPS.map((g) => g.id));
    for (const overlay of OVERLAYS) {
      expect(t(overlay.label)).not.toBe(overlay.label);
      expect(groups.has(overlay.group)).toBe(true);
      expect(overlay.swatch('light')).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('affiche par défaut le réseau réel et les communes', () => {
    expect(
      OVERLAYS.filter((o) => o.defaultVisible)
        .map((o) => o.id)
        .sort(),
    ).toEqual(['communes', 'real-network']);
  });

  it('crédite les producteurs de données', () => {
    expect(DATA_ATTRIBUTIONS.join(' ')).toMatch(/INSEE.*SNCF Réseau.*Parcs nationaux.*EU-DEM/s);
  });

  it('partage les sources du relief entre ombrage et courbes', () => {
    const relief = OVERLAYS.filter((o) => o.sources).map((o) => [o.id, dataKeyOf(o)]);
    expect(relief).toEqual([
      ['hillshade', 'relief'],
      ['contours', 'relief'],
    ]);
  });
});
