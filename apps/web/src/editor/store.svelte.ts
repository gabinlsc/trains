import {
  addNode,
  addSegment,
  DEFAULT_TRACK_SPEC,
  EMPTY_NETWORK,
  History,
  moveNode,
  NetworkError,
  removeNode,
  removeSegment,
  type Id,
  type Network,
  type Position,
  type TrackSpec,
} from '@trains/shared';
import { SvelteSet } from 'svelte/reactivity';
import type { SnapTarget } from './snap.ts';

export type Tool = 'select' | 'draw';

/** Point saisi pendant le tracé, éventuellement aimanté. */
export interface DraftPoint {
  position: Position;
  snap?: SnapTarget | null;
}

/**
 * État de l'éditeur : réseau, historique, sélection et outil actif. Le réseau
 * est stocké en $state.raw : les opérations sont immuables, une réaffectation
 * suffit à notifier l'interface, sans proxy réactif sur des milliers d'objets.
 */
export class EditorStore {
  network = $state.raw<Network>(EMPTY_NETWORK);
  tool = $state<Tool>('select');
  readonly selection = new SvelteSet<Id>();
  /** Caractéristiques appliquées aux nouveaux tronçons. */
  spec = $state<TrackSpec>({ ...DEFAULT_TRACK_SPEC });
  /** Dernier refus d'une opération (message affiché à l'utilisateur). */
  error = $state<string | null>(null);
  canUndo = $state(false);
  canRedo = $state(false);
  undoLabel = $state<string | null>(null);
  redoLabel = $state<string | null>(null);

  private readonly history: History<Network>;

  constructor(initial: Network = EMPTY_NETWORK) {
    this.history = new History(initial);
    this.network = initial;
  }

  private refresh(): void {
    this.network = this.history.state;
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
    this.undoLabel = this.history.undoLabel;
    this.redoLabel = this.history.redoLabel;
    // Une sélection qui ne désigne plus rien (suppression, annulation) est purgée.
    for (const id of [...this.selection]) {
      if (!this.network.nodes[id] && !this.network.segments[id]) this.selection.delete(id);
    }
  }

  /** Exécute une opération ; un refus (NetworkError) devient un message, pas une exception. */
  execute(label: string, apply: (network: Network) => Network, mergeKey?: string): boolean {
    try {
      this.history.execute({ label, apply, ...(mergeKey ? { mergeKey } : {}) });
      this.error = null;
      this.refresh();
      return true;
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      this.error = error.message;
      return false;
    }
  }

  undo(): void {
    this.history.undo();
    this.refresh();
  }

  redo(): void {
    this.history.redo();
    this.refresh();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.error = null;
  }

  select(id: Id, additive = false): void {
    if (!additive) this.selection.clear();
    if (additive && this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
  }

  clearSelection(): void {
    this.selection.clear();
  }

  /** Glisser un nœud : toutes les positions intermédiaires fusionnent en une étape. */
  moveNode(id: Id, position: Position): void {
    this.execute('Déplacer un nœud', (n) => moveNode(n, id, position), `move:${id}`);
  }

  endMove(): void {
    this.history.seal();
  }

  /** Supprime la sélection : tronçons d'abord, puis nœuds (avec leurs tronçons). */
  deleteSelection(): void {
    const ids = [...this.selection];
    if (ids.length === 0) return;
    this.execute(ids.length > 1 ? `Supprimer ${ids.length} éléments` : 'Supprimer', (network) => {
      let next = network;
      for (const id of ids) if (next.segments[id]) next = removeSegment(next, id);
      for (const id of ids) if (next.nodes[id]) next = removeNode(next, id);
      return next;
    });
  }

  /**
   * Crée un tronçon à partir des points saisis. Les extrémités aimantées à un
   * nœud le réutilisent (raccordement) ; aimantées à une gare réelle, elles
   * créent une gare liée à son code UIC. Les points intermédiaires forment le
   * tracé.
   */
  finishDraw(points: readonly DraftPoint[]): Id | null {
    if (points.length < 2) return null;
    // Objet plutôt que variable : l'affectation a lieu dans la commande.
    const created: { id: Id | null } = { id: null };
    const spec = { ...this.spec };
    this.execute('Tracer un tronçon', (network) => {
      let next = network;
      const endpoint = (point: DraftPoint): Id => {
        const snap = point.snap;
        if (snap?.kind === 'node' && next.nodes[snap.id]) return snap.id;
        const added =
          snap?.kind === 'station'
            ? addNode(next, snap.position, {
                name: snap.label,
                station: { type: 'gare', platforms: 2, terminus: false, existingUic: snap.uic },
              })
            : addNode(next, point.position);
        next = added.network;
        return added.node.id;
      };
      const from = endpoint(points[0] as DraftPoint);
      const to = endpoint(points[points.length - 1] as DraftPoint);
      const via = points.slice(1, -1).map((p) => p.snap?.position ?? p.position);
      const result = addSegment(next, from, to, { via, spec });
      created.id = result.segment.id;
      return result.network;
    });
    if (created.id) {
      this.selection.clear();
      this.selection.add(created.id);
    }
    return created.id;
  }
}
