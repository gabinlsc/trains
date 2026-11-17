<script lang="ts">
  import { createSave, parseSave, SaveError, serializeSave } from '@trains/shared';
  import type { EditorStore } from '../editor/store.svelte.ts';
  import { t } from '../i18n/index.ts';
  import { download, fileName, networkToGeoJSON } from './export.ts';
  import type { GamePersistence } from './persistence.svelte.ts';

  let { store, persistence }: { store: EditorStore; persistence: GamePersistence } = $props();

  let input: HTMLInputElement | undefined = $state();
  let message = $state<{ text: string; error: boolean } | null>(null);

  function exportSave(): void {
    const save = createSave(store.name, store.network);
    download(fileName(save.name, 'json'), serializeSave(save), 'application/json');
  }

  function exportGeoJSON(): void {
    download(
      fileName(store.name, 'geojson'),
      `${JSON.stringify(networkToGeoJSON(store.network))}\n`,
      'application/geo+json',
    );
  }

  async function importFile(file: File): Promise<void> {
    try {
      const save = parseSave(await file.text());
      store.load(save.network, save.name);
      persistence.changed();
      message = { text: t('game.imported', { name: save.name }), error: false };
    } catch (error) {
      const reason = error instanceof SaveError ? error.message : String(error);
      message = { text: t('game.importError', { reason }), error: true };
    }
  }

  function newGame(): void {
    if (Object.keys(store.network.nodes).length > 0 && !confirm(t('game.confirmNew'))) return;
    persistence.reset();
    message = null;
  }
</script>

<section class="game" aria-label={t('game.panel')}>
  <input
    class="name"
    type="text"
    maxlength="120"
    aria-label={t('game.name')}
    value={store.name}
    onchange={(event) => {
      store.name = event.currentTarget.value.trim() || 'Mon réseau';
      persistence.changed();
    }}
    onkeydown={(event) => {
      // Entrée valide et rend la main à la carte et à ses raccourcis.
      if (event.key === 'Enter') event.currentTarget.blur();
    }}
  />
  <div class="actions">
    <button type="button" title={t('game.new')} aria-label={t('game.new')} onclick={newGame}>
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><path d="M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6" /></svg
      >
    </button>
    <button
      type="button"
      title={t('game.import')}
      aria-label={t('game.import')}
      onclick={() => input?.click()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><path d="M12 15V3M7 10l5 5 5-5M4 17v4h16v-4" /></svg
      >
    </button>
    <button
      type="button"
      title={t('game.export')}
      aria-label={t('game.export')}
      onclick={exportSave}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><path d="M12 3v12M7 8l5-5 5 5M4 17v4h16v-4" /></svg
      >
    </button>
    <button
      type="button"
      title={t('game.geojson')}
      aria-label={t('game.geojson')}
      onclick={exportGeoJSON}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><circle cx="12" cy="12" r="9" /><path
          d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"
        /></svg
      >
    </button>
  </div>
  <input
    bind:this={input}
    type="file"
    accept=".json,application/json"
    hidden
    onchange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void importFile(file);
    }}
  />
  <p class="status" aria-live="polite">{t(`game.status.${persistence.status}`)}</p>
  {#if message}
    <p class="message" class:error={message.error} role={message.error ? 'alert' : 'status'}>
      {message.text}
    </p>
  {/if}
</section>

<style>
  .game {
    position: absolute;
    top: var(--space-3);
    left: 50%;
    z-index: 2;
    display: grid;
    grid-template-columns: minmax(8rem, 14rem) auto;
    gap: var(--space-1) var(--space-2);
    align-items: center;
    max-width: calc(100% - 2 * var(--space-3));
    padding: var(--space-2) var(--space-3);
    transform: translateX(-50%);
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--surface);
    box-shadow: 0 2px 12px rgb(0 0 0 / 0.12);
    font-size: 0.8125rem;
  }

  .name {
    min-width: 0;
    font: inherit;
    font-weight: 600;
  }

  .actions {
    display: flex;
    gap: var(--space-1);
  }

  button {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 0;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text);
    cursor: pointer;
  }

  button:hover {
    background: var(--bg);
  }

  svg {
    width: 1.125rem;
    height: 1.125rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .status,
  .message {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--text-muted);
  }

  .message.error {
    color: var(--text);
    padding-left: var(--space-2);
    border-left: 3px solid var(--signal);
  }

  @media (max-width: 40rem) {
    .game {
      top: auto;
      bottom: calc(var(--space-8) + 3rem);
    }
  }
</style>
