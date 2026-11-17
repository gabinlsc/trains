<script lang="ts">
  import { t } from './i18n/index.ts';
  import { router, ROUTES } from './lib/router.svelte.ts';
  import { theme } from './lib/theme.svelte.ts';
  import Landing from './pages/Landing.svelte';
  import NotFound from './pages/NotFound.svelte';

  // La carte (MapLibre, ≈ 250 kB compressés) n'est chargée qu'à la demande.
  const loadMapPage = () => import('./pages/MapPage.svelte');

  $effect(() => {
    document.documentElement.dataset.theme = theme.effective;
  });

  $effect(() => {
    const titles: Record<string, string> = { [ROUTES.map]: t('map.title') };
    const page = titles[router.path];
    document.title = page ? `${page} · ${t('app.name')}` : t('app.name');
  });
</script>

{#if router.path === ROUTES.home}
  <Landing />
{:else if router.path === ROUTES.map}
  {#await loadMapPage()}
    <p class="loading" role="status">{t('map.loading')}</p>
  {:then { default: MapPage }}
    <MapPage />
  {/await}
{:else}
  <NotFound />
{/if}

<style>
  .loading {
    padding: var(--space-8);
    text-align: center;
    color: var(--text-muted);
  }
</style>
