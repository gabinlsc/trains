<script lang="ts">
  import { segmentCost } from '@trains/engine';
  import { t } from '../i18n/index.ts';
  import { formatMoney } from './money.ts';
  import { smoothedPath } from './geometry.ts';
  import {
    analyseProfile,
    fetchProfile,
    type ProfileAnalysis,
    type TerrainProfile,
  } from './profile.ts';
  import type { EditorStore } from './store.svelte.ts';

  let { store }: { store: EditorStore } = $props();
  let open = $state(true);
  let profile = $state.raw<TerrainProfile | null>(null);
  let status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');

  /** Tronçon affiché : le seul tronçon sélectionné, s'il y en a exactement un. */
  const segment = $derived.by(() => {
    const ids = [...store.selection].filter((id) => store.network.segments[id]);
    return ids.length === 1 ? store.network.segments[ids[0] as string] : undefined;
  });
  const path = $derived(segment ? smoothedPath(store.network, segment) : null);
  const analysis = $derived<ProfileAnalysis | null>(
    profile && segment ? analyseProfile(profile, segment.spec.designSpeedKmh) : null,
  );

  const cost = $derived(
    analysis && segment
      ? segmentCost({
          lengthM: analysis.length,
          spec: segment.spec,
          structures: analysis.structures.map((s) => ({ kind: s.kind, lengthM: s.to - s.from })),
          earthworkDepthM: analysis.earthworkDepth,
        }).total
      : null,
  );

  // Récupère le profil à chaque changement de tracé, après une courte pause
  // (glisser un nœud produit une rafale de modifications).
  $effect(() => {
    const points = path;
    if (!points || !open) {
      profile = null;
      status = 'idle';
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      status = 'loading';
      fetchProfile(points, controller.signal).then(
        (result) => {
          profile = result;
          status = 'ready';
        },
        () => {
          // Une requête annulée (tracé modifié entre-temps) n'est pas une erreur.
          if (!controller.signal.aborted) {
            profile = null;
            status = 'error';
          }
        },
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  const W = 1000;
  const H = 200;
  const PAD = 6;
  const km = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const permille = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

  function scales(a: ProfileAnalysis): { x: (d: number) => number; y: (z: number) => number } {
    const span = Math.max(20, a.maxElevation - a.minElevation);
    const low = a.minElevation - span * 0.1;
    const high = a.maxElevation + span * 0.1;
    return {
      x: (d) => (a.length > 0 ? (d / a.length) * W : 0),
      y: (z) => PAD + (1 - (z - low) / (high - low)) * (H - 2 * PAD),
    };
  }

  function polyline(a: ProfileAnalysis, values: number[]): string {
    const { x, y } = scales(a);
    return (profile?.distance ?? [])
      .map((d, i) => `${x(d).toFixed(1)},${y(values[i] ?? 0).toFixed(1)}`)
      .join(' ');
  }

  function area(a: ProfileAnalysis): string {
    const { x } = scales(a);
    return `${x(0)},${H} ${polyline(a, a.terrain)} ${x(a.length)},${H}`;
  }
</script>

<section class="drawer" class:closed={!open} aria-labelledby="profile-title">
  <header>
    <h2 id="profile-title">{t('profile.title')}</h2>
    <button
      type="button"
      class="toggle"
      aria-expanded={open}
      aria-controls="profile-body"
      aria-label={open ? t('profile.close') : t('profile.open')}
      onclick={() => {
        open = !open;
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" class:flipped={!open}
        ><path d="M6 9l6 6 6-6" /></svg
      >
    </button>
  </header>

  <div id="profile-body" hidden={!open}>
    {#if !segment}
      <p class="note">{t('profile.empty')}</p>
    {:else if status === 'error'}
      <p class="note" role="status">{t('profile.unavailable')}</p>
    {:else if !analysis}
      <p class="note" role="status">{t('profile.loading')}</p>
    {:else}
      {@const a = analysis}
      {@const s = scales(a)}
      <svg
        class="chart"
        viewBox="0 0 {W} {H}"
        preserveAspectRatio="none"
        role="img"
        aria-label={t('profile.chart')}
      >
        {#each a.structures as structure (structure.from)}
          <rect
            class={structure.kind}
            x={s.x(structure.from)}
            y="0"
            width={Math.max(1, s.x(structure.to) - s.x(structure.from))}
            height={H}
          />
        {/each}
        <polygon class="terrain" points={area(a)} />
        <polyline class="track" points={polyline(a, a.track)} />
      </svg>
      <ul class="legend">
        <li><span class="key terrain" aria-hidden="true"></span>{t('profile.terrain')}</li>
        <li><span class="key track" aria-hidden="true"></span>{t('profile.track')}</li>
        <li><span class="key tunnel" aria-hidden="true"></span>{t('profile.tunnel')}</li>
        <li><span class="key viaduct" aria-hidden="true"></span>{t('profile.viaduct')}</li>
      </ul>
      <p class="stats">
        {t('profile.length', { km: km.format(a.length / 1000) })} ·
        {t('profile.grade', {
          track: permille.format(a.trackGrade),
          limit: a.limit,
          terrain: permille.format(a.terrainGrade),
        })}
        <br />
        {t('profile.structures', {
          tunnels: km.format(a.tunnelLength / 1000),
          viaducts: km.format(a.viaductLength / 1000),
        })}
        {#if cost !== null && a.length > 0}
          <br />
          {t('profile.cost', {
            amount: formatMoney(cost),
            perKm: formatMoney(cost / (a.length / 1000)),
          })}
        {/if}
      </p>
    {/if}
  </div>
</section>

<style>
  .drawer {
    position: absolute;
    right: calc(var(--space-3) + 3.5rem);
    bottom: var(--space-8);
    left: calc(
      var(--space-3) + min(20rem, calc(100% - 2 * var(--space-3) - 3rem)) + var(--space-3)
    );
    z-index: 2;
    max-height: 45%;
    overflow: auto;
    padding: var(--space-2) var(--space-4) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: var(--surface);
    box-shadow: 0 2px 12px rgb(0 0 0 / 0.12);
  }

  @media (max-width: 48rem) {
    .drawer {
      left: var(--space-3);
      right: var(--space-3);
    }
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

  .toggle {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    cursor: pointer;
  }

  .toggle svg {
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

  .chart {
    display: block;
    width: 100%;
    height: 9rem;
    margin-top: var(--space-2);
  }

  .terrain {
    fill: color-mix(in srgb, #a0794b 35%, transparent);
    stroke: #a0794b;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .track {
    fill: none;
    stroke: var(--signal);
    stroke-width: 2.5;
    vector-effect: non-scaling-stroke;
  }

  rect.tunnel {
    fill: color-mix(in srgb, var(--text) 18%, transparent);
  }

  rect.viaduct {
    fill: color-mix(in srgb, var(--line-b) 22%, transparent);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
    font-size: 0.8125rem;
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .key {
    width: 1rem;
    height: 0.625rem;
    border-radius: 2px;
  }

  .key.terrain {
    background: color-mix(in srgb, #a0794b 35%, transparent);
    border: 1px solid #a0794b;
  }

  .key.track {
    height: 3px;
    background: var(--signal);
  }

  .key.tunnel {
    background: color-mix(in srgb, var(--text) 25%, transparent);
  }

  .key.viaduct {
    background: color-mix(in srgb, var(--line-b) 35%, transparent);
  }

  .stats,
  .note {
    margin: var(--space-2) 0 0;
    font-size: 0.875rem;
    color: var(--text-muted);
  }
</style>
