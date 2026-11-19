<script lang="ts">
  import type { EditorStore } from '../editor/store.svelte.ts';
  import { formatMoney } from '../editor/money.ts';
  import { formatDuration } from '../editor/service.ts';
  import { t } from '../i18n/index.ts';
  import { networkKpis } from './kpis.ts';
  import type { DemandModel } from './model.svelte.ts';

  let {
    store,
    demand,
    heat = $bindable(false),
  }: { store: EditorStore; demand: DemandModel; heat?: boolean } = $props();

  const count = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const km = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const big = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

  const kpis = $derived(networkKpis(store.network, demand.result));
  const matrix = $derived(demand.result?.matrix);
  const name = (id: string): string => store.network.nodes[id]?.name ?? t('inspector.station');
  const pending = $derived(demand.status === 'loading' || demand.status === 'computing');
  const orDash = (value: number | null, format: (v: number) => string): string =>
    value === null ? '—' : format(value);

  const groups = $derived([
    {
      title: t('dashboard.infrastructure'),
      tiles: [
        [t('dashboard.track'), `${km.format(kpis.trackKm)} km`],
        [t('dashboard.stations'), count.format(kpis.stations)],
        [t('dashboard.capex'), formatMoney(kpis.capexM)],
        [t('dashboard.maintenance'), `${formatMoney(kpis.maintenanceM)} ${t('dashboard.perYear')}`],
      ],
    },
    {
      title: t('dashboard.operations'),
      tiles: [
        [t('dashboard.lines'), count.format(kpis.lines)],
        [t('dashboard.fleet'), `${count.format(kpis.fleet)} (${formatMoney(kpis.fleetCostM)})`],
        [t('dashboard.operating'), `${formatMoney(kpis.operatingM)} ${t('dashboard.perYear')}`],
      ],
    },
    {
      title: t('dashboard.traffic'),
      tiles: [
        [t('dashboard.trips'), orDash(kpis.tripsPerDay, (v) => count.format(v))],
        [t('dashboard.pkm'), orDash(kpis.passengerKmPerYear, (v) => big.format(v))],
        [
          t('dashboard.revenue'),
          orDash(kpis.revenueM, (v) => `${formatMoney(v)} ${t('dashboard.perYear')}`),
        ],
        [
          t('dashboard.balance'),
          orDash(kpis.balanceM, (v) => `${formatMoney(v)} ${t('dashboard.perYear')}`),
        ],
        [t('dashboard.co2'), orDash(kpis.co2AvoidedT, (v) => `${count.format(v)} t`)],
      ],
    },
  ]);
</script>

<section class="dashboard" aria-label={t('dashboard.title')}>
  <header>
    <h2>{t('dashboard.title')}</h2>
    <button
      type="button"
      aria-label={t('dashboard.close')}
      title={t('dashboard.close')}
      onclick={() => {
        store.dashboard = false;
      }}>×</button
    >
  </header>
  {#if pending}
    <p class="muted" role="status">{t('lines.demandPending')}</p>
  {:else if demand.status === 'unavailable'}
    <p class="muted">{t('lines.demandUnavailable')}</p>
  {/if}

  {#each groups as group (group.title)}
    <h3>{group.title}</h3>
    <dl class="tiles">
      {#each group.tiles as [label, value] (label)}
        <div class="tile">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      {/each}
    </dl>
  {/each}

  <label class="check">
    <input type="checkbox" bind:checked={heat} />
    {t('dashboard.heat')}
  </label>

  {#if matrix && matrix.stations.length >= 2}
    <h3>{t('dashboard.matrix')}</h3>
    <div class="scroll">
      <table>
        <caption class="visually-hidden">{t('dashboard.matrixCaption')}</caption>
        <thead>
          <tr>
            <td></td>
            {#each matrix.stations as id (id)}
              <th scope="col">{name(id)}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each matrix.stations as from, i (from)}
            <tr>
              <th scope="row">{name(from)}</th>
              {#each matrix.minutes[i] ?? [] as value, j (j)}
                <td>{value === null ? '—' : i === j ? '' : formatDuration(value * 60)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  <p class="note">{t('dashboard.note')}</p>
</section>

<style>
  .dashboard {
    position: absolute;
    top: var(--space-3);
    right: calc(var(--space-3) + 3.5rem);
    bottom: var(--space-8);
    z-index: 3;
    width: min(30rem, calc(100% - 2 * var(--space-3) - 3.5rem));
    overflow: auto;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--surface);
    box-shadow: 0 2px 12px rgb(0 0 0 / 0.12);
    font-size: 0.875rem;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: 1.125rem;
  }

  h3 {
    margin: var(--space-4) 0 var(--space-2);
    font-size: 0.9375rem;
  }

  header button {
    width: 2rem;
    height: 2rem;
    border: 0;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text);
    font-size: 1.25rem;
    cursor: pointer;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    gap: var(--space-2);
    margin: 0;
  }

  .tile {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
  }

  dt {
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  dd {
    margin: var(--space-1) 0 0;
    font-size: 1.0625rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .scroll {
    overflow-x: auto;
  }

  table {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--border);
    text-align: right;
    white-space: nowrap;
  }

  th[scope='row'] {
    text-align: left;
  }

  thead th {
    font-weight: 600;
    color: var(--text-muted);
  }

  .muted,
  .note {
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
  }

  .note {
    margin-top: var(--space-4);
    font-size: 0.8125rem;
  }
</style>
