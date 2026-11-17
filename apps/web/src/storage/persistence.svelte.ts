import { createSave, EMPTY_NETWORK } from '@trains/shared';
import type { EditorStore } from '../editor/store.svelte.ts';
import { debounce, type GameStorage } from './projects.ts';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unavailable';

/** Délai entre la dernière modification et l'écriture locale. */
const AUTOSAVE_DELAY_MS = 800;

/**
 * Sauvegarde automatique de la partie dans le navigateur : restauration au
 * chargement de la carte, écriture différée après chaque modification.
 */
export class GamePersistence {
  status = $state<SaveStatus>('idle');
  private readonly store: EditorStore;
  private readonly storage: GameStorage | null;
  private restored = false;
  readonly schedule: ReturnType<typeof debounce<[]>>;

  constructor(store: EditorStore, storage: GameStorage | null) {
    this.store = store;
    this.storage = storage;
    if (!storage) this.status = 'unavailable';
    this.schedule = debounce(() => {
      void this.write();
    }, AUTOSAVE_DELAY_MS);
  }

  /** Recharge la partie en cours ; sans elle, l'éditeur reste vide. */
  async restore(): Promise<void> {
    if (!this.storage) return;
    try {
      const game = await this.storage.load();
      if (game) this.store.load(game.network, game.name);
    } catch {
      this.status = 'unavailable';
    } finally {
      this.restored = true;
    }
  }

  /**
   * Demande une écriture ; ignorée tant que la restauration n'a pas eu lieu.
   * Les arguments ne servent qu'à déclarer les dépendances d'un $effect.
   */
  changed(..._dependencies: unknown[]): void {
    if (this.restored && this.storage && this.status !== 'unavailable') this.schedule();
  }

  async write(): Promise<void> {
    if (!this.storage) return;
    this.status = 'saving';
    try {
      await this.storage.save(createSave(this.store.name, this.store.network));
      this.status = 'saved';
    } catch {
      this.status = 'error';
    }
  }

  /** Nouvelle partie : réseau vide, sauvegarde locale remplacée. */
  reset(): void {
    this.store.load(EMPTY_NETWORK, 'Mon réseau');
    this.changed();
  }
}
