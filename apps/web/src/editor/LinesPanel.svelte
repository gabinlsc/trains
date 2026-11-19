<script lang="ts">
  import { lineRoute, routeCompatibility, routeSegments } from '@trains/engine';
  import {
    departuresPerDay,
    ROLLING_STOCK,
    rollingStockById,
    type Line,
    type TrackSpec,
  } from '@trains/shared';
  import { t } from '../i18n/index.ts';
  import type { EditorStore } from './store.svelte.ts';

  let { store }: { store: EditorStore } = $props();

  const HEADWAYS = [10, 15, 20, 30, 60, 120, 240] as const;
  const km = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

  const lines = $derived(Object.values(store.network.lines));
  const line = $derived(store.activeLine ? store.network.lines[store.activeLine] : undefined);

  const details = $derived.by(() => {
    if (!line) return null;
    const route = lineRoute(store.network, line);
    const specs = routeSegments(route)
      .map((step) => store.network.segments[step.segment]?.spec)
      .filter((spec): spec is TrackSpec => spec !== undefined);
    const stock = rollingStockById(line.stock);
    return {
      route,
      stock,
      compatibility: stock ? routeCompatibility(stock, specs) : null,
      stopNames: line.stops.map((id) => store.network.nodes[id]?.name ?? t('inspector.station')),
    };
  });

  const time = (minutes: number): string =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const minutes = (value: string): number | null => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };

  function patch(current: Line, change: Partial<Line>, mergeKey?: string): void {
    store.updateLine(current.id, change, mergeKey);
  }
</script>

{#if lines.length > 0 || store.tool === 'line'}
  <section class="lines" aria-label={t('lines.title')}>
    <h2>{t('lines.title')}</h2>
    {#if lines.length === 0}
      <p class="muted">{t('lines.empty')}</p>
    {:else}
      <ul class="list">
        {#each lines as item (item.id)}
          <li>
            <button
              type="button"
              aria-pressed={store.activeLine === item.id}
              onclick={() => {
                store.activeLine = store.activeLine === item.id ? null : item.id;
              }}
            >
              <span class="code" style:background={item.color}>{item.code}</span>
              {item.name}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if line && details}
      <div class="detail" role="group" aria-label={t('lines.settings', { code: line.code })}>
        <label class="field">
          {t('lines.name')}
          <input
            type="text"
            maxlength="60"
            value={line.name}
            onchange={(event) => {
              const name = event.currentTarget.value.trim();
              if (name) patch(line, { name });
            }}
          />
        </label>
        <div class="row">
          <label class="field">
            {t('lines.code')}
            <input
              type="text"
              maxlength="8"
              value={line.code}
              onchange={(event) => {
                const code = event.currentTarget.value.trim();
                if (code) patch(line, { code });
              }}
            />
          </label>
          <label class="field">
            {t('lines.color')}
            <input
              type="color"
              value={line.color}
              onchange={(event) => {
                patch(line, { color: event.currentTarget.value.toLowerCase() });
              }}
            />
          </label>
        </div>
        <label class="field">
          {t('lines.stock')}
          <select
            value={line.stock}
            onchange={(event) => {
              patch(line, { stock: event.currentTarget.value });
            }}
          >
            {#each ROLLING_STOCK.filter((s) => s.category !== 'fret') as stock (stock.id)}
              <option value={stock.id}>{stock.name}</option>
            {/each}
          </select>
        </label>
        <div class="row">
          <label class="field">
            {t('lines.headway')}
            <select
              value={line.headwayMin}
              onchange={(event) => {
                patch(line, { headwayMin: Number(event.currentTarget.value) });
              }}
            >
              {#each HEADWAYS as headway (headway)}
                <option value={headway}>{t('lines.every', { minutes: headway })}</option>
              {/each}
            </select>
          </label>
          <label class="field">
            {t('lines.first')}
            <input
              type="time"
              value={time(line.firstDepartureMin)}
              onchange={(event) => {
                const value = minutes(event.currentTarget.value);
                if (value !== null && value <= line.lastDepartureMin)
                  patch(line, { firstDepartureMin: value });
              }}
            />
          </label>
          <label class="field">
            {t('lines.last')}
            <input
              type="time"
              value={time(line.lastDepartureMin)}
              onchange={(event) => {
                const value = minutes(event.currentTarget.value);
                if (value !== null && value >= line.firstDepartureMin)
                  patch(line, { lastDepartureMin: value });
              }}
            />
          </label>
        </div>
        <p class="muted">
          {t('lines.summary', {
            km: km.format(details.route.lengthM / 1000),
            departures: departuresPerDay(line),
          })}
        </p>
        <ol class="stops">
          {#each details.stopNames as name, i (i)}
            <li>{name}</li>
          {/each}
        </ol>
        {#if !details.route.ok}
          <p class="warn" role="status">
            {t('lines.unreachable', {
              stops: details.route.unreachable
                .map((i) => `${details.stopNames[i] ?? ''} → ${details.stopNames[i + 1] ?? ''}`)
                .join(', '),
            })}
          </p>
        {/if}
        {#if details.compatibility && !details.compatibility.ok}
          <p class="warn" role="status">
            {details.compatibility.issues.map((issue) => t(`lines.issues.${issue}`)).join(' ')}
          </p>
        {/if}
        <button
          type="button"
          class="danger"
          onclick={() => {
            store.removeLine(line.id);
          }}>{t('lines.delete')}</button
        >
      </div>
    {/if}
  </section>
{/if}

<style>
  .lines {
    position: absolute;
    bottom: var(--space-8);
    left: var(--space-3);
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: min(20rem, calc(100% - 2 * var(--space-3) - 3rem));
    max-height: 45%;
    overflow: auto;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--surface);
    box-shadow: 0 2px 12px rgb(0 0 0 / 0.12);
    font-size: 0.875rem;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
  }

  .list,
  .stops {
    margin: 0;
    padding: 0;
  }

  .list {
    list-style: none;
  }

  .list button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1);
    border: 0;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .list button[aria-pressed='true'],
  .list button:hover {
    background: var(--bg);
  }

  .code {
    min-width: 2.25rem;
    padding: 0 var(--space-1);
    border-radius: var(--radius-s);
    color: #fff;
    font-weight: 700;
    text-align: center;
  }

  .detail {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border);
  }

  .row {
    display: flex;
    gap: var(--space-2);
  }

  .field {
    display: grid;
    flex: 1;
    gap: var(--space-1);
    font-weight: 600;
  }

  input,
  select {
    min-width: 0;
    font: inherit;
    font-weight: 400;
  }

  .stops {
    padding-left: var(--space-6);
  }

  .muted {
    margin: 0;
    color: var(--text-muted);
  }

  .warn {
    margin: 0;
    padding-left: var(--space-2);
    border-left: 3px solid #f2a900;
  }

  .danger {
    justify-self: start;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--signal);
    border-radius: var(--radius-s);
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
</style>
