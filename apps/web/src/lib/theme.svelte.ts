import type { Theme } from '../map/style.ts';

/** Choix de l'utilisateur ; « auto » suit le réglage du système. */
export type ThemePreference = 'auto' | Theme;

const STORAGE_KEY = 'rdf:theme';

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch {
    // Stockage inaccessible (navigation privée, cookies bloqués) : réglage système.
    return 'auto';
  }
}

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

class ThemeState {
  preference = $state<ThemePreference>(readPreference());
  private systemDark = $state(media?.matches ?? false);

  constructor() {
    media?.addEventListener('change', (event) => {
      this.systemDark = event.matches;
    });
  }

  get effective(): Theme {
    if (this.preference !== 'auto') return this.preference;
    return this.systemDark ? 'dark' : 'light';
  }

  /** Bascule clair/sombre en partant du thème affiché. */
  toggle(): void {
    this.set(this.effective === 'dark' ? 'light' : 'dark');
  }

  set(preference: ThemePreference): void {
    this.preference = preference;
    try {
      if (preference === 'auto') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Préférence non mémorisée : sans conséquence.
    }
  }
}

export const theme = new ThemeState();
