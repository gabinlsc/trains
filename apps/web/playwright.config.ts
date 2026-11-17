import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// DATA_DIR d'essai : un jeu de données minimal (e2e/fixtures/data/), sans
// fond de carte, ce qui éprouve aussi le comportement en mode dégradé.
const dataDir = fileURLToPath(new URL('./e2e/fixtures', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    locale: 'fr-FR',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // WebGL logiciel : la carte s'affiche sans GPU.
        launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    env: { DATA_DIR: dataDir },
    timeout: 60_000,
  },
});
