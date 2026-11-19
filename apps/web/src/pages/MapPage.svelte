<script lang="ts">
  import { t } from '../i18n/index.ts';
  import { handleLinkClick, ROUTES } from '../lib/router.svelte.ts';
  import ThemeToggle from '../lib/ThemeToggle.svelte';
  import MapView from '../map/MapView.svelte';
</script>

<div class="layout">
  <header class="bar">
    <a class="brand" href={ROUTES.home} onclick={handleLinkClick}>
      <span class="logo" aria-hidden="true"></span>
      {t('app.name')}
    </a>
    <nav>
      <a href={ROUTES.rollingStock} onclick={handleLinkClick}>{t('nav.rollingStock')}</a>
    </nav>
    <ThemeToggle />
  </header>
  <main class="stage">
    <h1 class="visually-hidden">{t('map.title')}</h1>
    <MapView />
  </main>
</div>

<style>
  .layout {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100vh;
    height: 100dvh;
  }

  nav {
    margin-left: auto;
  }

  nav a {
    color: var(--text);
    font-weight: 600;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text);
    font-weight: 800;
    text-decoration: none;
  }

  .logo {
    width: 1.25rem;
    height: 0.375rem;
    border-radius: 999px;
    background: var(--line-a);
  }

  .stage {
    position: relative;
    min-height: 0;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
