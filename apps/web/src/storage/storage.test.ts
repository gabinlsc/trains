import { IDBFactory } from 'fake-indexeddb';
import { addNode, addSegment, createSave, EMPTY_NETWORK, type Network } from '@trains/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorStore } from '../editor/store.svelte.ts';
import { fileName, networkToGeoJSON } from './export.ts';
import { GamePersistence } from './persistence.svelte.ts';
import { debounce, GameStorage } from './projects.ts';

function network(): Network {
  let n = EMPTY_NETWORK;
  n = addNode(n, [2.2, 47.0], {
    id: 'n_aaaaaa',
    name: 'Bourges',
    station: { type: 'gare', platforms: 4, terminus: false, existingUic: '87576207' },
  }).network;
  n = addNode(n, [2.4, 47.1], { id: 'n_bbbbbb' }).network;
  return addSegment(n, 'n_aaaaaa', 'n_bbbbbb', { id: 's_ssssss' }).network;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('stockage local', () => {
  it('enregistre, relit et efface la partie en cours', async () => {
    const storage = new GameStorage(new IDBFactory());
    expect(await storage.load()).toBeNull();
    const save = createSave('Centre', network(), new Date('2026-11-17T10:00:00Z'));
    await storage.save(save);
    expect(await storage.load()).toEqual(save);
    await storage.clear();
    expect(await storage.load()).toBeNull();
  });

  it('restaure la partie au démarrage puis sauvegarde après les modifications', async () => {
    const factory = new IDBFactory();
    await new GameStorage(factory).save(createSave('Centre', network()));
    const store = new EditorStore();
    const persistence = new GamePersistence(store, new GameStorage(factory));
    persistence.changed();
    await persistence.restore();
    expect(store.name).toBe('Centre');
    expect(Object.keys(store.network.segments)).toEqual(['s_ssssss']);
    expect(store.canUndo).toBe(false);

    store.select('s_ssssss');
    store.deleteSelection();
    persistence.changed();
    persistence.schedule.flush();
    await vi.waitFor(() => {
      expect(persistence.status).toBe('saved');
    });
    const reloaded = await new GameStorage(factory).load();
    expect(reloaded?.network.segments).toEqual({});

    persistence.reset();
    expect(store.network).toEqual(EMPTY_NETWORK);
    expect(store.name).toBe('Mon réseau');
  });

  it('signale l’absence de stockage', () => {
    const persistence = new GamePersistence(new EditorStore(), null);
    expect(persistence.status).toBe('unavailable');
  });

  it('regroupe les appels rapprochés', () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const fn = debounce((n: number) => calls.push(n), 100);
    fn(1);
    fn(2);
    vi.advanceTimersByTime(99);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([2]);
    fn(3);
    fn.cancel();
    fn.flush();
    expect(calls).toEqual([2]);
  });
});

describe('export GeoJSON', () => {
  it('exporte tronçons et nœuds avec leurs caractéristiques', () => {
    const geo = networkToGeoJSON(network());
    expect(geo.features).toHaveLength(3);
    const segment = geo.features.find((f) => f.id === 's_ssssss');
    expect(segment?.geometry.type).toBe('LineString');
    expect(segment?.properties).toMatchObject({ type: 'troncon', voies: 2, vitesse_kmh: 160 });
    expect(segment?.properties?.longueur_m).toBeGreaterThan(15_000);
    const station = geo.features.find((f) => f.id === 'n_aaaaaa');
    expect(station?.properties).toMatchObject({
      type: 'gare',
      nom: 'Bourges',
      quais: 4,
      uic: '87576207',
    });
    expect(geo.features.find((f) => f.id === 'n_bbbbbb')?.properties).toMatchObject({
      type: 'point',
      nom: null,
    });
  });

  it('dérive un nom de fichier sûr', () => {
    expect(fileName('Ligne Lyon – Turin (variante 2)', 'json')).toBe(
      'ligne-lyon-turin-variante-2.json',
    );
    expect(fileName('???', 'geojson')).toBe('reseau.geojson');
  });
});
