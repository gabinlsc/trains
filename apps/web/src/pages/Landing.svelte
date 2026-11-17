<script lang="ts">
  import { t } from '../i18n/index.ts';
  import { handleLinkClick, ROUTES } from '../lib/router.svelte.ts';
  import ThemeToggle from '../lib/ThemeToggle.svelte';
  import { DEMO_LINE_CODE, DEMO_STATIONS } from '../lib/demo-line.ts';

  const features = ['build', 'services', 'impact'] as const;
  const year = new Date().getFullYear();

  // Positions régulières le long du trait ; la viewBox fixe l'échelle.
  const width = 640;
  const margin = 48;
  const step = (width - 2 * margin) / (DEMO_STATIONS.length - 1);
  const stations = DEMO_STATIONS.map((name, i) => ({ name, x: margin + i * step }));
</script>

<main class="landing">
  <div class="top"><ThemeToggle /></div>
  <header class="masthead">
    <p class="status"><span class="dot" aria-hidden="true"></span>{t('landing.status')}</p>
    <h1>{t('app.name')}</h1>
    <p class="tagline">{t('app.tagline')}</p>
  </header>

  <figure class="diagram">
    <svg viewBox="0 0 {width} 130" role="img" aria-label={t('landing.diagramLabel')}>
      <line x1={margin} y1="65" x2={width - margin} y2="65" class="track" />
      {#each stations as station, i (station.name)}
        <g transform="translate({station.x} 65)">
          <circle r={i === 0 || i === stations.length - 1 ? 11 : 8} class="station" />
          <!-- Étiquettes alternées pour rester lisibles sur petit écran ; le
               terminus est aligné à droite pour ne pas sortir du cadre. -->
          <text
            x={i === stations.length - 1 ? 12 : 0}
            y={i % 2 === 0 ? 40 : -26}
            text-anchor={i === stations.length - 1 ? 'end' : 'middle'}
            class="station-name">{station.name}</text
          >
        </g>
      {/each}
      <g transform="translate({margin - 32} 65)" aria-hidden="true">
        <rect x="-14" y="-14" width="28" height="28" rx="6" class="code-badge" />
        <text y="6" text-anchor="middle" class="code">{DEMO_LINE_CODE}</text>
      </g>
    </svg>
  </figure>

  <p class="pitch">{t('landing.pitch')}</p>

  <p class="cta-row">
    <a class="cta" href={ROUTES.map} onclick={handleLinkClick}>{t('landing.openMap')}</a>
  </p>

  <ul class="features">
    {#each features as feature (feature)}
      <li>
        <span class="badge badge-{feature}" aria-hidden="true">
          {t(`landing.features.${feature}.code`)}
        </span>
        <div>
          <h2>{t(`landing.features.${feature}.title`)}</h2>
          <p>{t(`landing.features.${feature}.text`)}</p>
        </div>
      </li>
    {/each}
  </ul>

  <footer>
    <p>{t('footer.attribution')}</p>
    <p>© {year} {t('app.name')}</p>
  </footer>
</main>

<style>
  .landing {
    max-width: 56rem;
    margin: 0 auto;
    padding: var(--space-12) var(--space-6) var(--space-8);
  }

  .top {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--space-6);
  }

  .masthead {
    border-left: 6px solid var(--accent);
    padding-left: var(--space-6);
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .dot {
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 50%;
    background: var(--line-c);
  }

  h1 {
    margin: 0;
    font-size: clamp(2.5rem, 7vw, 4.5rem);
    line-height: 1.05;
    letter-spacing: -0.02em;
  }

  .tagline {
    margin: var(--space-3) 0 0;
    font-size: 1.25rem;
    color: var(--text-muted);
  }

  .diagram {
    margin: var(--space-12) 0 var(--space-8);
  }

  .diagram svg {
    display: block;
    width: 100%;
    height: auto;
  }

  .track {
    stroke: var(--line-a);
    stroke-width: 10;
    stroke-linecap: round;
  }

  .station {
    fill: var(--surface);
    stroke: var(--text);
    stroke-width: 4;
  }

  .station-name {
    fill: var(--text);
    font-size: 15px;
    font-weight: 600;
  }

  @media (max-width: 40rem) {
    .station-name {
      font-size: 24px;
    }
  }

  .code-badge {
    fill: var(--line-a);
  }

  .code {
    fill: #fff;
    font-size: 17px;
    font-weight: 800;
  }

  .pitch {
    max-width: 44rem;
    font-size: 1.125rem;
  }

  .cta-row {
    margin: var(--space-6) 0 0;
  }

  .cta {
    display: inline-block;
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-m);
    background: var(--accent);
    color: var(--accent-contrast);
    font-weight: 700;
    text-decoration: none;
  }

  .cta:hover {
    filter: brightness(1.1);
  }

  .features {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: var(--space-4);
    margin: var(--space-8) 0;
    padding: 0;
    list-style: none;
  }

  .features li {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
  }

  .features h2 {
    margin: 0 0 var(--space-1);
    font-size: 1.0625rem;
  }

  .features p {
    margin: 0;
    color: var(--text-muted);
  }

  .badge {
    flex: none;
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-s);
    font-weight: 800;
    color: #fff;
  }

  .badge-build {
    background: var(--line-a);
  }

  .badge-services {
    background: var(--line-b);
  }

  /* Jaune : texte foncé pour garder le contraste. */
  .badge-impact {
    background: var(--line-c);
    color: #14181f;
  }

  footer {
    margin-top: var(--space-12);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  footer p {
    margin: 0 0 var(--space-1);
  }
</style>
