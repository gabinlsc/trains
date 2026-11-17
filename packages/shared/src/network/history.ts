/**
 * Historique d'annulation illimité, sur le patron commande : chaque commande
 * transforme un état immuable en un nouvel état ; l'historique conserve les
 * paires avant/après. Grâce au partage de structure des états, garder des
 * milliers d'étapes coûte peu.
 */
export interface Command<T> {
  /** Libellé affiché dans l'interface (« Déplacer la gare de Lyon »). */
  label: string;
  apply: (state: T) => T;
  /**
   * Deux commandes successives de même clé fusionnent en une seule étape
   * (glisser un nœud produit des dizaines de déplacements, un seul « annuler »).
   */
  mergeKey?: string;
}

interface Entry<T> {
  label: string;
  before: T;
  after: T;
  mergeKey?: string;
}

export class History<T> {
  private past: Entry<T>[] = [];
  private future: Entry<T>[] = [];
  private current: T;

  constructor(initial: T) {
    this.current = initial;
  }

  get state(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null;
  }

  get size(): number {
    return this.past.length;
  }

  /** Exécute une commande ; une commande sans effet n'entre pas dans l'historique. */
  execute(command: Command<T>): T {
    const before = this.current;
    const after = command.apply(before);
    if (after === before) return before;
    const last = this.past.at(-1);
    if (
      command.mergeKey !== undefined &&
      last?.mergeKey === command.mergeKey &&
      this.future.length === 0
    ) {
      last.after = after;
    } else {
      this.past.push({
        label: command.label,
        before,
        after,
        ...(command.mergeKey !== undefined ? { mergeKey: command.mergeKey } : {}),
      });
    }
    this.future = [];
    this.current = after;
    return after;
  }

  /** Clôt une série fusionnable : la commande suivante ouvrira une nouvelle étape. */
  seal(): void {
    const last = this.past.at(-1);
    if (last) delete last.mergeKey;
  }

  undo(): T {
    const entry = this.past.pop();
    if (!entry) return this.current;
    delete entry.mergeKey;
    this.future.push(entry);
    this.current = entry.before;
    return this.current;
  }

  redo(): T {
    const entry = this.future.pop();
    if (!entry) return this.current;
    this.past.push(entry);
    this.current = entry.after;
    return this.current;
  }

  /** Remplace l'état sans historique (chargement d'un projet). */
  reset(state: T): void {
    this.past = [];
    this.future = [];
    this.current = state;
  }
}
