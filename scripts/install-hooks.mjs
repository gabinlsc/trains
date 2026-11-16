// Installe les hooks Git en développement uniquement. En production
// (release copiée sans .git) ou en CI, il n'y a rien à installer et
// l'installation ne doit surtout pas échouer.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

if (process.env.CI || process.env.NODE_ENV === 'production' || !existsSync('.git')) {
  process.exit(0);
}

try {
  execFileSync('pnpm', ['exec', 'simple-git-hooks'], { stdio: 'inherit' });
} catch {
  console.warn('Hooks Git non installés : lancer « pnpm exec simple-git-hooks » manuellement.');
}
