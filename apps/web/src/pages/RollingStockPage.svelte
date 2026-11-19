<script lang="ts">
  import {
    GAUGE_MM,
    ROLLING_STOCK,
    RollingStockCategorySchema,
    type RollingStock,
  } from '@trains/shared';
  import { formatMoney } from '../editor/money.ts';
  import { t } from '../i18n/index.ts';
  import { handleLinkClick, ROUTES } from '../lib/router.svelte.ts';
  import ThemeToggle from '../lib/ThemeToggle.svelte';

  const num = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const groups = RollingStockCategorySchema.options
    .map((category) => ({
      category,
      items: ROLLING_STOCK.filter((s) => s.category === category),
    }))
    .filter((g) => g.items.length > 0);

  function specs(stock: RollingStock): [string, string][] {
    const rows: [string, string][] = [
      [t('rollingStock.speed'), `${stock.maxSpeedKmh} km/h`],
      stock.category === 'fret'
        ? [t('rollingStock.payload'), `${num.format(stock.payloadT)} t`]
        : [t('rollingStock.seats'), num.format(stock.seats)],
    ];
    if (stock.capacity > stock.seats)
      rows.push([t('rollingStock.capacity'), num.format(stock.capacity)]);
    rows.push(
      [t('rollingStock.traction'), t(`rollingStock.tractions.${stock.traction}`)],
      [
        t('rollingStock.voltages'),
        stock.voltages.length
          ? stock.voltages.map((v) => t(`electrifications.${v}`)).join(', ')
          : '—',
      ],
      [t('rollingStock.gauge'), `${num.format(GAUGE_MM[stock.gauge])} mm`],
      [t('rollingStock.length'), `${num.format(stock.lengthM)} m`],
      [t('rollingStock.power'), `${num.format(stock.powerKw)} kW`],
      [t('rollingStock.acceleration'), `${num.format(stock.accelerationMs2)} m/s²`],
      [t('rollingStock.price'), formatMoney(stock.priceM)],
      [
        t('rollingStock.operating'),
        t('rollingStock.perTrainKm', { amount: num.format(stock.costPerTrainKm) }),
      ],
    );
    return rows;
  }
</script>

<header class="bar">
  <a class="brand" href={ROUTES.home} onclick={handleLinkClick}>
    <span class="logo" aria-hidden="true"></span>
    {t('app.name')}
  </a>
  <nav>
    <a href={ROUTES.map} onclick={handleLinkClick}>{t('nav.map')}</a>
  </nav>
  <ThemeToggle />
</header>

<main class="page">
  <h1>{t('rollingStock.title')}</h1>
  <p class="intro">{t('rollingStock.intro')}</p>

  {#each groups as group (group.category)}
    <section aria-labelledby="cat-{group.category}">
      <h2 id="cat-{group.category}">{t(`rollingStock.categories.${group.category}`)}</h2>
      <ul class="cards">
        {#each group.items as stock (stock.id)}
          <li class="card">
            <h3>{stock.name}</h3>
            <dl>
              {#each specs(stock) as [label, value] (label)}
                <dt>{label}</dt>
                <dd>{value}</dd>
              {/each}
            </dl>
            {#if stock.cabSignalling}
              <p class="note">{t('rollingStock.cab')}</p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</main>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text);
    font-weight: 700;
    text-decoration: none;
  }

  .logo {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    background: var(--accent);
  }

  nav {
    margin-left: auto;
  }

  nav a {
    color: var(--text);
    font-weight: 600;
  }

  .page {
    max-width: 72rem;
    margin: 0 auto;
    padding: var(--space-8) var(--space-4) var(--space-12);
  }

  .intro {
    max-width: 48rem;
    color: var(--text-muted);
  }

  h2 {
    margin-top: var(--space-8);
    font-size: 1.25rem;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .card {
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--surface);
  }

  h3 {
    margin: 0 0 var(--space-3);
    font-size: 1rem;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: 0.875rem;
  }

  dt {
    color: var(--text-muted);
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .note {
    margin: var(--space-3) 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
</style>
