import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/basemap-cli.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@trains\//],
});
