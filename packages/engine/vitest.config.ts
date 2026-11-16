import { defineConfig } from 'vitest/config';

// Le moteur est le cœur du calcul (scores officiels recalculés côté
// serveur) : la couverture minimale est contractuelle et bloque la CI.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
