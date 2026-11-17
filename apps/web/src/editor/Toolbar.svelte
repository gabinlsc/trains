<script lang="ts">
  import { minRadiusForSpeed } from '@trains/engine';
  import { t } from '../i18n/index.ts';
  import type { EditorStore } from './store.svelte.ts';

  let { store }: { store: EditorStore } = $props();

  const SPEEDS = [100, 160, 220, 320] as const;
  const fmt = new Intl.NumberFormat('fr-FR');
</script>

<div class="toolbar" role="toolbar" aria-label={t('editor.toolbar')} aria-orientation="vertical">
  <button
    type="button"
    aria-pressed={store.tool === 'select'}
    title={t('editor.select')}
    aria-label={t('editor.select')}
    onclick={() => {
      store.setTool('select');
    }}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 9-6 1.5L10 20z" /></svg>
  </button>
  <button
    type="button"
    aria-pressed={store.tool === 'draw'}
    title={t('editor.draw')}
    aria-label={t('editor.draw')}
    onclick={() => {
      store.setTool('draw');
    }}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"
      ><path d="M4 20c4-1 6-9 10-12s5-3 6-4" /><circle cx="4" cy="20" r="1.8" /><circle
        cx="20"
        cy="4"
        r="1.8"
      /></svg
    >
  </button>
  <hr />
  <button
    type="button"
    disabled={!store.canUndo}
    title={store.undoLabel ? t('editor.undoNamed', { label: store.undoLabel }) : t('editor.undo')}
    aria-label={t('editor.undo')}
    onclick={() => {
      store.undo();
    }}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7H4V2M4 7a9 9 0 1 1-1 7" /></svg>
  </button>
  <button
    type="button"
    disabled={!store.canRedo}
    title={store.redoLabel ? t('editor.redoNamed', { label: store.redoLabel }) : t('editor.redo')}
    aria-label={t('editor.redo')}
    onclick={() => {
      store.redo();
    }}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 7h5V2M20 7a9 9 0 1 0 1 7" /></svg>
  </button>
  <button
    type="button"
    disabled={store.selection.size === 0}
    title={t('editor.delete')}
    aria-label={t('editor.delete')}
    onclick={() => {
      store.deleteSelection();
    }}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg
    >
  </button>
</div>

{#if store.tool === 'draw'}
  <div class="draw-panel" role="group" aria-label={t('editor.draw')}>
    <p class="hint">{t('editor.drawHint')}</p>
    <label>
      {t('editor.speed')}
      <select
        value={store.spec.designSpeedKmh}
        onchange={(event) => {
          store.spec = { ...store.spec, designSpeedKmh: Number(event.currentTarget.value) };
        }}
      >
        {#each SPEEDS as speed (speed)}
          <option value={speed}>{speed} km/h</option>
        {/each}
      </select>
    </label>
    <p class="radius">
      {t('editor.radius', { radius: fmt.format(minRadiusForSpeed(store.spec.designSpeedKmh)) })}
    </p>
  </div>
{/if}

{#if store.error}
  <p class="error" role="alert">{store.error}</p>
{/if}

<style>
  .toolbar {
    position: absolute;
    top: 50%;
    right: var(--space-3);
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-1);
    transform: translateY(-50%);
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--surface);
    box-shadow: 0 2px 12px rgb(0 0 0 / 0.12);
  }

  button {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border: 0;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text);
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--bg);
  }

  button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--accent-contrast);
  }

  button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  svg {
    width: 1.25rem;
    height: 1.25rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  hr {
    width: 70%;
    margin: var(--space-1) auto;
    border: 0;
    border-top: 1px solid var(--border);
  }

  .draw-panel,
  .error {
    position: absolute;
    bottom: var(--space-8);
    left: 50%;
    z-index: 2;
    max-width: min(32rem, calc(100% - 2 * var(--space-4)));
    margin: 0;
    padding: var(--space-3) var(--space-4);
    transform: translateX(-50%);
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--surface);
    box-shadow: 0 2px 12px rgb(0 0 0 / 0.12);
    font-size: 0.875rem;
  }

  .error {
    bottom: calc(var(--space-8) + 7rem);
    border-left: 4px solid var(--signal);
  }

  .hint {
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
  }

  label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 600;
  }

  select {
    font: inherit;
  }

  .radius {
    margin: var(--space-1) 0 0;
    color: var(--text-muted);
  }
</style>
