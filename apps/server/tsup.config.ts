import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

interface RootPackage {
  version: string;
}

const rootPackage = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as RootPackage;

/**
 * Commit court figé dans le bundle. deploy.sh construit depuis une copie sans
 * .git et transmet donc GIT_COMMIT ; en local on interroge Git.
 */
function shortCommit(): string {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'inconnu';
  }
}

export default defineConfig({
  entry: ['src/main.ts', 'src/migrate.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  // Les paquets internes sont livrés en source TypeScript : on les embarque.
  noExternal: [/^@trains\//],
  define: {
    __APP_VERSION__: JSON.stringify(rootPackage.version),
    __APP_COMMIT__: JSON.stringify(shortCommit()),
  },
});
