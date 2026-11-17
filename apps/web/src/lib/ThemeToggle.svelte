<script lang="ts">
  import { t } from '../i18n/index.ts';
  import { theme } from './theme.svelte.ts';

  const label = $derived(theme.effective === 'dark' ? t('theme.toLight') : t('theme.toDark'));
</script>

<button
  type="button"
  class="toggle"
  aria-label={label}
  title={label}
  onclick={() => {
    theme.toggle();
  }}
>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#if theme.effective === 'dark'}
      <circle cx="12" cy="12" r="5" />
      <path
        d="M12 1v3M12 20v3M1 12h3M20 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
      />
    {:else}
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    {/if}
  </svg>
</button>

<style>
  .toggle {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }

  .toggle:hover {
    border-color: var(--text-muted);
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
</style>
