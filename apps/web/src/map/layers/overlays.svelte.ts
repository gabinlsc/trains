import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { SvelteSet } from 'svelte/reactivity';
import type { Theme } from '../style.ts';
import { dataKeyOf, OVERLAYS, sourceId, type OverlayDefinition } from './catalog.ts';
import { SourceCache } from './source-cache.ts';

export type OverlayStatus = 'idle' | 'loading' | 'ready' | 'error';

const STORAGE_KEY = 'rdf:layers';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function readVisible(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const ids = JSON.parse(raw) as unknown;
      if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === 'string');
    }
  } catch {
    // Préférences illisibles ou stockage bloqué : valeurs par défaut.
  }
  return OVERLAYS.filter((o) => o.defaultVisible).map((o) => o.id);
}

/**
 * Calques de données au-dessus du fond de carte. L'état (visibilité, statut
 * de chargement) est réactif pour le panneau ; la carte est synchronisée à
 * chaque changement et après chaque changement de style.
 */
export class OverlayManager {
  readonly visible = new SvelteSet<string>(readVisible());
  status = $state<Record<string, OverlayStatus>>(
    Object.fromEntries(OVERLAYS.map((o) => [o.id, 'idle'])),
  );

  private map: MapLibreMap | null = null;
  private theme: Theme = 'light';
  private readonly cache = new SourceCache();
  /**
   * Vrai une fois sources et couches ajoutées au style courant. On ne se fie
   * pas à isStyleLoaded(), encore faux pendant l'événement « style.load ».
   */
  private installed = false;

  attach(map: MapLibreMap, theme: Theme): void {
    this.map = map;
    this.theme = theme;
    // style.load : premier chargement, puis après chaque setStyle (thème).
    map.on('style.load', () => {
      this.install();
    });
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  isVisible(id: string): boolean {
    return this.visible.has(id);
  }

  toggle(id: string): void {
    this.setVisible(id, !this.visible.has(id));
  }

  setVisible(id: string, on: boolean): void {
    if (on) this.visible.add(id);
    else this.visible.delete(id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.visible]));
    } catch {
      // Préférence non mémorisée : sans conséquence.
    }
    this.sync();
  }

  /** Ajoute sources et couches au style courant, au-dessus du fond de carte. */
  private install(): void {
    const map = this.map;
    if (!map) return;
    // Nouveau style : ses sources sont neuves.
    this.cache.resetApplied();
    this.installed = false;
    for (const overlay of OVERLAYS) {
      if (overlay.load) {
        const key = dataKeyOf(overlay);
        const id = sourceId(key);
        if (!map.getSource(id)) {
          const data = this.cache.get(key);
          map.addSource(id, { type: 'geojson', data: data ?? EMPTY, tolerance: 0.4 });
          if (data) this.cache.markApplied(key);
        }
      }
      for (const layer of overlay.layers(this.theme)) {
        if (!map.getLayer(layer.id)) map.addLayer(layer);
      }
    }
    this.installed = true;
    this.sync();
  }

  /** Visibilité des couches, masquage des doublons du fond, chargement à la demande. */
  private sync(): void {
    const map = this.map;
    if (!map || !this.installed) return;
    const hidden: string[] = [];
    for (const overlay of OVERLAYS) {
      const on = this.visible.has(overlay.id);
      for (const layer of overlay.layers(this.theme)) {
        if (map.getLayer(layer.id))
          map.setLayoutProperty(layer.id, 'visibility', on ? 'visible' : 'none');
      }
      if (on) {
        hidden.push(...(overlay.hidesBasemapLayers ?? []));
        void this.ensureData(overlay);
      }
    }
    for (const overlay of OVERLAYS) {
      for (const id of overlay.hidesBasemapLayers ?? []) {
        if (map.getLayer(id))
          map.setLayoutProperty(id, 'visibility', hidden.includes(id) ? 'none' : 'visible');
      }
    }
  }

  private async ensureData(overlay: OverlayDefinition): Promise<void> {
    if (!overlay.load) {
      this.status[overlay.id] = 'ready';
      return;
    }
    const key = dataKeyOf(overlay);
    if (this.status[overlay.id] === 'idle' || this.status[overlay.id] === 'error') {
      this.status[overlay.id] = 'loading';
    }
    try {
      const data = await this.cache.load(key, overlay.load);
      const source = this.map?.getSource<GeoJSONSource>(sourceId(key));
      if (source && !this.cache.isApplied(key)) {
        void source.setData(data);
        this.cache.markApplied(key);
      }
      this.status[overlay.id] = 'ready';
    } catch {
      // Une nouvelle activation retentera le chargement.
      this.status[overlay.id] = 'error';
    }
  }
}
