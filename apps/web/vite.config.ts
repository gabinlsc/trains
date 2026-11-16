import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  build: {
    target: 'es2022',
    // Aucun script ni style en ligne : la CSP de production l'interdit.
    assetsInlineLimit: 0,
    sourcemap: true,
    reportCompressedSize: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3070',
      '/ws': { target: 'ws://127.0.0.1:3070', ws: true },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
