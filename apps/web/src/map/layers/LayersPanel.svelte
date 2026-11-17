<script lang="ts">
  import { t } from '../../i18n/index.ts';
  import { theme } from '../../lib/theme.svelte.ts';
  import { GROUPS, OVERLAYS } from './catalog.ts';
  import type { OverlayManager } from './overlays.svelte.ts';

  let { manager }: { manager: OverlayManager } = $props();
  let open = $state(true);
</script>

<section class="panel" aria-labelledby="layers-title">
  <header>
    <h2 id="layers-title">{t('layers.title')}</h2>
    <button
      type="button"
      class="collapse"
      aria-expanded={open}
      aria-controls="layers-list"
      aria-label={open ? t('layers.close') : t('layers.open')}
      onclick={() => {
        open = !open;
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" class:flipped={!open}
        ><path d="M6 15l6-6 6 6" /></svg
      >
    </button>
  </header>

  <div id="layers-list" hidden={!open}>
    {#each GROUPS as group (group.id)}
      <fieldset>
        <legend>{t(group.label)}</legend>
        {#each OVERLAYS.filter((o) => o.group === group.id) as overlay (overlay.id)}
          {@const status = manager.status[overlay.id]}
          <label class="row">
            <input
              type="checkbox"
              checked={manager.visible.has(overlay.id)}
              onchange={(event) => {
                manager.setVisible(overlay.id, event.currentTarget.checked);
              }}
            />
            <span
              class="swatch"
              class:dashed={overlay.dashed}
              style:--swatch={overlay.swatch(theme.effective)}
              aria-hidden="true"
            ></span>
            <span class="text">
              {t(overlay.label)}
              {#if manager.visible.has(overlay.id) && status === 'loading'}
                <span class="note">{t('layers.loading')}</span>
              {:else if manager.visible.has(overlay.id) && status === 'error'}
                <span class="note error">{t('layers.error')}</span>
              {/if}
            </span>
          </label>
        {/each}
      </fieldset>
    {/each}
  </div>
</section>

<style>
  .panel {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    z-index: 2;
    width: min(20rem, calc(100% - 2 * var(--space-3) - 3rem));
    max-height: calc(100% - 6rem);
    overflow: auto;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--surface);
    box-shadow: 0 2px 12px rgb(0 0 0 / 0.12);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: 0.9375rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .collapse {
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

  .collapse svg {
    width: 1.1rem;
    height: 1.1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .flipped {
    transform: rotate(180deg);
  }

  fieldset {
    margin: var(--space-3) 0 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    margin-bottom: var(--space-1);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .row {
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    font-size: 0.875rem;
    cursor: pointer;
  }

  input {
    width: 1rem;
    height: 1rem;
    margin: 0;
    accent-color: var(--accent);
  }

  /* Pastille : trait plein ou pointillé, la couleur n'est jamais seule. */
  .swatch {
    width: 1.25rem;
    height: 0.25rem;
    border-radius: 2px;
    background: var(--swatch);
  }

  .swatch.dashed {
    background: repeating-linear-gradient(90deg, var(--swatch) 0 4px, transparent 4px 7px);
  }

  .note {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .note.error {
    color: var(--signal);
  }
</style>
