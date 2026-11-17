import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import sirv from 'sirv';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * En développement et en prévisualisation, sert /tiles et /data depuis
 * DATA_DIR comme le fait Nginx en production (requêtes Range comprises,
 * indispensables à PMTiles).
 */
function localData(): Plugin {
  const dataDir = resolve(
    process.env.DATA_DIR ?? resolve(import.meta.dirname, '../../.local/data'),
  );
  const mount = (server: {
    middlewares: { use: (path: string, handler: ReturnType<typeof sirv>) => void };
  }) => {
    server.middlewares.use('/tiles', sirv(resolve(dataDir, 'tiles'), { dev: true, etag: true }));
    server.middlewares.use(
      '/data',
      sirv(resolve(dataDir, 'data'), { dev: true, etag: true, dotfiles: false }),
    );
  };
  return {
    name: 'rdf-local-data',
    configureServer: mount,
    configurePreviewServer: mount,
  };
}

export default defineConfig({
  plugins: [svelte(), localData()],
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
  preview: {
    port: 4173,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
