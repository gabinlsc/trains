<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import {
    addProtocol,
    AttributionControl,
    Map as MapLibreMap,
    NavigationControl,
    ScaleControl,
    setWorkerUrl,
    type ErrorEvent as MapErrorEvent,
    type MapSourceDataEvent,
  } from 'maplibre-gl';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import { Protocol } from 'pmtiles';
  import { onDestroy, onMount } from 'svelte';
  import { t } from '../i18n/index.ts';
  import { theme } from '../lib/theme.svelte.ts';
  import { EditorController } from '../editor/controller.ts';
  import type { SnapTarget } from '../editor/snap.ts';
  import { EditorStore } from '../editor/store.svelte.ts';
  import Inspector from '../editor/Inspector.svelte';
  import ProfileDrawer from '../editor/ProfileDrawer.svelte';
  import Toolbar from '../editor/Toolbar.svelte';
  import { loadDataFile, type Table } from './layers/data.ts';
  import { DATA_ATTRIBUTIONS } from './layers/catalog.ts';
  import LayersPanel from './layers/LayersPanel.svelte';
  import { OverlayManager } from './layers/overlays.svelte.ts';
  import { BASEMAP_ATTRIBUTION, BASEMAP_SOURCE, buildStyle } from './style.ts';
  import { FRANCE_BOUNDS, MAX_BOUNDS, MAX_ZOOM, MIN_ZOOM } from './view.ts';

  let container: HTMLDivElement;
  let map: MapLibreMap | null = null;
  let basemapError = $state(false);
  let webglError = $state(false);
  let appliedTheme = theme.effective;
  const overlays = new OverlayManager();
  const editor = new EditorStore();
  let controller: EditorController | null = null;
  let stationsRequested = false;

  /** Gares réelles proposées à l'aimantation, chargées au premier tracé. */
  async function loadSnapStations(): Promise<void> {
    if (stationsRequested || !controller) return;
    stationsRequested = true;
    try {
      const table = await loadDataFile<Table>('gares.json');
      const f = Object.fromEntries(table.fields.map((name, i) => [name, i]));
      controller.stations = table.rows.map((row): SnapTarget => ({
        kind: 'station',
        uic: String(row[f.uic as number]),
        label: String(row[f.nom as number]),
        position: [row[f.lng as number] as number, row[f.lat as number] as number],
      }));
    } catch {
      // Sans données de gares, l'aimantation se limite au réseau du joueur.
      stationsRequested = false;
    }
  }

  /** Raccourcis clavier de l'éditeur ; inactifs pendant la saisie dans un champ. */
  function onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    // Seuls les champs de saisie bloquent les raccourcis ; une case à cocher
    // (panneau des calques) garde le focus sans rien saisir.
    const typing =
      'textarea, select, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="button"])';
    if (target?.closest(typing)) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) editor.redo();
      else editor.undo();
    } else if (mod && key === 'y') {
      event.preventDefault();
      editor.redo();
    } else if (mod) {
      return;
    } else if (key === 'v') {
      controller?.cancel();
      editor.setTool('select');
    } else if (key === 't') {
      editor.setTool('draw');
    } else if (key === 'enter' && controller?.drafting) {
      controller.finish();
    } else if (key === 'escape') {
      if (controller?.drafting) controller.cancel();
      else editor.clearSelection();
    } else if (key === 'backspace' && controller?.drafting) {
      event.preventDefault();
      controller.undoPoint();
    } else if ((key === 'delete' || key === 'backspace') && editor.selection.size > 0) {
      event.preventDefault();
      editor.deleteSelection();
    }
  }

  // Le worker est émis par Vite comme fichier à part (même origine, compatible
  // avec la CSP « worker-src 'self' ») ; MapLibre ne le trouve pas seul une
  // fois le module regroupé.
  setWorkerUrl(workerUrl);

  // Le protocole est global à MapLibre : on ne l'enregistre qu'une fois.
  const globalKey = '__rdfPmtilesProtocol';
  const registry = globalThis as unknown as Record<string, Protocol | undefined>;
  if (!registry[globalKey]) {
    const protocol = new Protocol();
    addProtocol('pmtiles', protocol.tile);
    registry[globalKey] = protocol;
  }

  onMount(() => {
    try {
      map = new MapLibreMap({
        container,
        style: buildStyle(appliedTheme, location.origin),
        bounds: FRANCE_BOUNDS,
        maxBounds: MAX_BOUNDS,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        // Respecte prefers-reduced-motion.
        fadeDuration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300,
      });
    } catch {
      webglError = true;
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    // Attributions toujours visibles : licences ODbL et Licence Ouverte.
    map.addControl(
      new AttributionControl({
        compact: false,
        customAttribution: [BASEMAP_ATTRIBUTION, ...DATA_ATTRIBUTIONS],
      }),
      'bottom-right',
    );

    overlays.attach(map, appliedTheme);
    controller = new EditorController(map, editor, appliedTheme);

    map.on('error', (event: MapErrorEvent & { sourceId?: string }) => {
      const sourceId = (event as { sourceId?: string }).sourceId;
      if (sourceId === BASEMAP_SOURCE || /pmtiles|france\.pmtiles/.test(event.error.message)) {
        basemapError = true;
      }
    });
    map.on('sourcedata', (event: MapSourceDataEvent) => {
      if (event.sourceId === BASEMAP_SOURCE && event.isSourceLoaded) basemapError = false;
    });
  });

  // Changement de thème : nouveau style, la caméra est conservée.
  $effect(() => {
    const next = theme.effective;
    if (!map || next === appliedTheme) return;
    appliedTheme = next;
    overlays.setTheme(next);
    controller?.setTheme(next);
    map.setStyle(buildStyle(next, location.origin));
  });

  // Toute modification du réseau ou de la sélection redessine la carte.
  $effect(() => {
    controller?.render(editor.network, [...editor.selection]);
  });

  $effect(() => {
    if (editor.tool === 'draw') void loadSnapStations();
    else controller?.cancel();
  });

  onDestroy(() => {
    map?.remove();
    map = null;
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="map-wrap">
  <div class="map" bind:this={container} role="region" aria-label={t('map.label')}></div>
  {#if !webglError}
    <LayersPanel manager={overlays} />
    <Toolbar store={editor} />
    <Inspector store={editor} />
    <ProfileDrawer store={editor} />
  {/if}
  {#if basemapError}
    <p class="banner" role="status">{t('map.basemapUnavailable')}</p>
  {/if}
  {#if webglError}
    <p class="banner error" role="alert">{t('map.webglUnavailable')}</p>
  {/if}
</div>

<style>
  .map-wrap {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .map {
    position: absolute;
    inset: 0;
    background: var(--bg);
  }

  .banner {
    position: absolute;
    top: var(--space-4);
    left: 50%;
    transform: translateX(-50%);
    max-width: min(36rem, calc(100% - 2 * var(--space-4)));
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-left: 4px solid var(--line-c);
    border-radius: var(--radius-m);
    background: var(--surface);
    color: var(--text);
    font-size: 0.9375rem;
    box-shadow: 0 2px 12px rgb(0 0 0 / 0.12);
  }

  .banner.error {
    border-left-color: var(--signal);
  }

  /* Contrôles MapLibre accordés au thème de l'application. */
  .map-wrap :global(.maplibregl-ctrl-group) {
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .map-wrap :global(.maplibregl-ctrl-group button + button) {
    border-top-color: var(--border);
  }

  :global(:root[data-theme='dark']) .map-wrap :global(.maplibregl-ctrl-icon) {
    filter: invert(1);
  }

  .map-wrap :global(.maplibregl-ctrl-attrib) {
    background: color-mix(in srgb, var(--surface) 85%, transparent);
    color: var(--text-muted);
  }

  .map-wrap :global(.maplibregl-ctrl-attrib a) {
    color: var(--text);
  }

  .map-wrap :global(.maplibregl-ctrl-scale) {
    background: color-mix(in srgb, var(--surface) 85%, transparent);
    border-color: var(--text-muted);
    color: var(--text);
  }
</style>
