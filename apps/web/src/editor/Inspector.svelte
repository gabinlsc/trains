<script lang="ts">
  import {
    checkCurvature,
    junctionCost,
    minRadiusForSpeed,
    polylineLength,
    segmentCost,
    stationCost,
  } from '@trains/engine';
  import {
    ElectrificationSchema,
    GaugeSchema,
    segmentsAt,
    SignallingSchema,
    StationTypeSchema,
    TRACK_COUNTS,
    type Station,
    type TrackSpec,
  } from '@trains/shared';
  import type { DemandModel } from '../demand/model.svelte.ts';
  import { t } from '../i18n/index.ts';
  import { smoothedPath } from './geometry.ts';
  import { formatMoney } from './money.ts';
  import { DEFAULT_PLATFORMS, type EditorStore } from './store.svelte.ts';

  let { store, demand }: { store: EditorStore; demand: DemandModel } = $props();
  const count = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

  const SPEEDS = [60, 100, 160, 220, 320] as const;
  const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

  const selected = $derived(store.selection.size === 1 ? [...store.selection][0] : undefined);
  const node = $derived(selected ? store.network.nodes[selected] : undefined);
  const segment = $derived(selected ? store.network.segments[selected] : undefined);

  const branches = $derived(node ? segmentsAt(store.network, node.id).length : 0);
  const segmentInfo = $derived.by(() => {
    if (!segment) return null;
    const path = smoothedPath(store.network, segment);
    const lengthM = polylineLength(path);
    return {
      km: lengthM / 1000,
      cost: segmentCost({ lengthM, spec: segment.spec }).total,
      curves: checkCurvature(path, minRadiusForSpeed(segment.spec.designSpeedKmh)).length,
    };
  });
  const speeds = $derived(
    segment && !(SPEEDS as readonly number[]).includes(segment.spec.designSpeedKmh)
      ? [...SPEEDS, segment.spec.designSpeedKmh].sort((a, b) => a - b)
      : [...SPEEDS],
  );

  function patchStation(patch: Partial<Station>): void {
    if (!node?.station) return;
    store.setStation(node.id, { ...node.station, ...patch });
  }

  function patchSpec(patch: Partial<TrackSpec>): void {
    if (segment) store.updateSpec(segment.id, patch);
  }
</script>

{#if store.selection.size > 1}
  <aside class="inspector" aria-label={t('inspector.title')}>
    <p class="muted">{t('inspector.multiple', { count: store.selection.size })}</p>
  </aside>
{:else if node}
  <aside class="inspector" aria-label={t('inspector.title')}>
    <h2>{t(`inspector.${node.kind}`)}</h2>
    <label class="field">
      {t('inspector.name')}
      <input
        type="text"
        maxlength="80"
        value={node.name ?? ''}
        oninput={(event) => {
          store.renameNode(node.id, event.currentTarget.value);
        }}
        onblur={() => {
          store.seal();
        }}
      />
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={node.kind === 'station'}
        onchange={(event) => {
          store.setStation(
            node.id,
            event.currentTarget.checked
              ? { type: 'gare', platforms: DEFAULT_PLATFORMS.gare, terminus: false }
              : null,
          );
        }}
      />
      {t('inspector.isStation')}
    </label>
    {#if node.station}
      <label class="field">
        {t('inspector.stationType')}
        <select
          value={node.station.type}
          onchange={(event) => {
            const type = StationTypeSchema.parse(event.currentTarget.value);
            patchStation({ type, platforms: DEFAULT_PLATFORMS[type] });
          }}
        >
          {#each StationTypeSchema.options as type (type)}
            <option value={type}>{t(`stationTypes.${type}`)}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        {t('inspector.platforms')}
        <input
          type="number"
          min="1"
          max="40"
          value={node.station.platforms}
          onchange={(event) => {
            const value = Math.round(Number(event.currentTarget.value));
            if (value >= 1 && value <= 40) patchStation({ platforms: value });
          }}
        />
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={node.station.terminus}
          onchange={(event) => {
            patchStation({ terminus: event.currentTarget.checked });
          }}
        />
        {t('inspector.terminus')}
      </label>
      {@const area = demand.result?.catchments[node.id]}
      {#if area}
        <p class="muted">
          {t('inspector.demand', {
            population: count.format(area.population),
            boardings: count.format(demand.result?.boardings[node.id] ?? 0),
          })}
        </p>
      {/if}
      {#if node.station.existingUic}
        <p class="muted">{t('inspector.existing', { uic: node.station.existingUic })}</p>
      {/if}
    {/if}
    {#if node.kind === 'junction'}
      <label class="check">
        <input
          type="checkbox"
          checked={node.flyover ?? false}
          onchange={(event) => {
            store.setFlyover(node.id, event.currentTarget.checked);
          }}
        />
        {t('inspector.flyover')}
      </label>
    {/if}
    <p class="muted">{t('inspector.branches', { count: branches })}</p>
    {#if node.station !== undefined || node.kind === 'junction'}
      <p class="cost">
        {t('inspector.cost', {
          amount: formatMoney(
            node.station ? stationCost(node.station) : junctionCost(node.flyover ?? false),
          ),
        })}
      </p>
    {/if}
  </aside>
{:else if segment && segmentInfo}
  <aside class="inspector" aria-label={t('inspector.title')}>
    <h2>{t('inspector.segment')}</h2>
    <p class="muted">{t('inspector.length', { km: fmt.format(segmentInfo.km) })}</p>
    <label class="field">
      {t('inspector.tracks')}
      <select
        value={String(segment.spec.tracks)}
        onchange={(event) => {
          const tracks = TRACK_COUNTS.find((n) => String(n) === event.currentTarget.value);
          if (tracks) patchSpec({ tracks });
        }}
      >
        {#each TRACK_COUNTS as count (count)}
          <option value={String(count)}>{t(`trackCounts.${count}`)}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      {t('inspector.speed')}
      <select
        value={segment.spec.designSpeedKmh}
        onchange={(event) => {
          patchSpec({ designSpeedKmh: Number(event.currentTarget.value) });
        }}
      >
        {#each speeds as speed (speed)}
          <option value={speed}>{speed} km/h</option>
        {/each}
      </select>
    </label>
    <label class="field">
      {t('inspector.electrification')}
      <select
        value={segment.spec.electrification}
        onchange={(event) => {
          patchSpec({ electrification: ElectrificationSchema.parse(event.currentTarget.value) });
        }}
      >
        {#each ElectrificationSchema.options as value (value)}
          <option {value}>{t(`electrifications.${value}`)}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      {t('inspector.signalling')}
      <select
        value={segment.spec.signalling}
        onchange={(event) => {
          patchSpec({ signalling: SignallingSchema.parse(event.currentTarget.value) });
        }}
      >
        {#each SignallingSchema.options as value (value)}
          <option {value}>{t(`signallings.${value}`)}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      {t('inspector.gauge')}
      <select
        value={segment.spec.gauge}
        onchange={(event) => {
          patchSpec({ gauge: GaugeSchema.parse(event.currentTarget.value) });
        }}
      >
        {#each GaugeSchema.options as value (value)}
          <option {value}>{t(`gauges.${value}`)}</option>
        {/each}
      </select>
    </label>
    <p class="cost">{t('inspector.costPlain', { amount: formatMoney(segmentInfo.cost) })}</p>
    {#if segmentInfo.curves > 0}
      <p class="warn">{t('inspector.curves', { count: segmentInfo.curves })}</p>
    {/if}
  </aside>
{/if}

<style>
  .inspector {
    position: absolute;
    top: calc(var(--space-3) + 4.5rem);
    right: calc(var(--space-3) + 3.5rem);
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: min(17rem, calc(100% - 2 * var(--space-3) - 3.5rem));
    max-height: calc(50% - 5rem);
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

  .field {
    display: grid;
    gap: var(--space-1);
    font-weight: 600;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  input[type='text'],
  input[type='number'],
  select {
    font: inherit;
    font-weight: 400;
  }

  .cost {
    margin: 0;
    font-weight: 600;
  }

  .muted,
  .warn {
    margin: 0;
    color: var(--text-muted);
  }

  .warn {
    padding-left: var(--space-2);
    border-left: 3px solid #f2a900;
    color: var(--text);
  }
</style>
