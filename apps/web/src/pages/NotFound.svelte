<script lang="ts">
  import { t } from '../i18n/index.ts';
  import { handleLinkClick, ROUTES } from '../lib/router.svelte.ts';
</script>

<main class="not-found">
  <h1>{t('notFound.title')}</h1>
  <p>{t('notFound.text')}</p>
  <a href={ROUTES.home} onclick={handleLinkClick}>{t('notFound.back')}</a>
</main>

<style>
  .not-found {
    max-width: 40rem;
    margin: 0 auto;
    padding: var(--space-12) var(--space-6);
  }

  a {
    color: var(--accent);
    font-weight: 600;
  }
</style>
