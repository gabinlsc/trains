/**
 * Routeur minimal fondé sur l'API History : quelques pages, pas de
 * paramètres complexes. Nginx renvoie index.html pour toute route inconnue.
 */
export const ROUTES = {
  home: '/',
  map: '/carte',
  rollingStock: '/materiel',
} as const;
export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/** Normalise un chemin : supprime la barre finale (sauf pour la racine). */
export function normalisePath(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? '/';
  return clean.length > 1 ? clean.replace(/\/+$/, '') || '/' : '/';
}

class Router {
  path = $state(normalisePath(typeof location === 'undefined' ? '/' : location.pathname));

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', () => {
        this.path = normalisePath(location.pathname);
      });
    }
  }

  navigate(path: string): void {
    const target = normalisePath(path);
    if (target === this.path) return;
    history.pushState(null, '', target);
    this.path = target;
    window.scrollTo(0, 0);
  }
}

export const router = new Router();

/**
 * Gestionnaire de clic pour les liens internes : laisse au navigateur les
 * clics modifiés (nouvel onglet) et les liens externes.
 */
export function handleLinkClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = (event.currentTarget as HTMLElement).closest('a');
  if (!anchor || anchor.target || anchor.origin !== location.origin) return;
  event.preventDefault();
  router.navigate(anchor.pathname);
}
