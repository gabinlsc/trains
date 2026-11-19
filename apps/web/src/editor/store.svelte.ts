import {
  addLine,
  addNode,
  addSegment,
  DEFAULT_TRACK_SPEC,
  EMPTY_NETWORK,
  History,
  insertNodeOnSegment,
  moveNode,
  NetworkError,
  removeLine,
  removeNode,
  removeSegment,
  updateLine,
  updateNode,
  updateSegment,
  type Id,
  type LineInput,
  type Network,
  type Position,
  type Station,
  type StationType,
  type TrackSpec,
} from '@trains/shared';
import { SvelteSet } from 'svelte/reactivity';
import type { SnapTarget } from './snap.ts';

export type Tool = 'select' | 'draw' | 'line';

/** Couleurs proposées aux nouvelles lignes, contrastées sur les deux thèmes. */
export const LINE_COLORS = [
  '#0072ce',
  '#e4002b',
  '#00a650',
  '#f39200',
  '#7b2d8e',
  '#00a3a6',
  '#b5843b',
  '#e5007d',
] as const;

/** Nombre de quais proposé à la création d'une gare, selon son type. */
export const DEFAULT_PLATFORMS: Readonly<Record<StationType, number>> = {
  halte: 1,
  gare: 2,
  correspondance: 4,
  tgv: 6,
};

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
  /** Nom de la partie, repris dans les sauvegardes et les fichiers exportés. */
  name = $state('Mon réseau');
  tool = $state<Tool>('select');
  readonly selection = new SvelteSet<Id>();
  /** Caractéristiques appliquées aux nouveaux tronçons. */
  spec = $state<TrackSpec>({ ...DEFAULT_TRACK_SPEC });
  /** Dernier refus d'une opération (message affiché à l'utilisateur). */
  error = $state<string | null>(null);
  /** Gares cliquées pour la ligne en cours de création. */
  lineDraft = $state<Id[]>([]);
  /** Ligne ouverte dans le panneau des lignes. */
  activeLine = $state<Id | null>(null);
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
    if (this.activeLine && !this.network.lines[this.activeLine]) this.activeLine = null;
    this.lineDraft = this.lineDraft.filter((id) => this.network.nodes[id]?.kind === 'station');
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

  /** Remplace tout le réseau (chargement, import) : l'historique repart de zéro. */
  load(network: Network, name?: string): void {
    this.history.reset(network);
    if (name) this.name = name;
    this.selection.clear();
    this.error = null;
    this.refresh();
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
    if (tool !== 'line') this.lineDraft = [];
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
        // Sur un tronçon : il est scindé et le nœud créé deviendra bifurcation.
        if (snap?.kind === 'segment' && next.segments[snap.id]) {
          const inserted = insertNodeOnSegment(next, snap.id, snap.position);
          next = inserted.network;
          return inserted.node.id;
        }
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

  /** Renomme un nœud ; la saisie au clavier forme une seule étape d'historique. */
  renameNode(id: Id, name: string): void {
    const trimmed = name.trim();
    this.execute(
      'Renommer',
      (network) => {
        const node = network.nodes[id];
        if (!node) return network;
        if (trimmed) return updateNode(network, id, { name: trimmed.slice(0, 80) });
        const { name: _removed, ...rest } = node;
        return { ...network, nodes: { ...network.nodes, [id]: rest } };
      },
      `rename:${id}`,
    );
  }

  /** Fait d'un nœud une gare, ou lui retire ce rôle (null). */
  setStation(id: Id, station: Station | null): void {
    this.execute(station ? 'Modifier la gare' : 'Retirer la gare', (network) =>
      updateNode(network, id, { station: station ?? undefined }),
    );
  }

  setFlyover(id: Id, flyover: boolean): void {
    this.execute(flyover ? 'Saut-de-mouton' : 'Croisement à niveau', (network) =>
      updateNode(network, id, { flyover }),
    );
  }

  /** Modifie les caractéristiques d'un tronçon. */
  updateSpec(id: Id, patch: Partial<TrackSpec>): void {
    this.execute('Modifier le tronçon', (network) => {
      const segment = network.segments[id];
      if (!segment) return network;
      return updateSegment(network, id, { spec: { ...segment.spec, ...patch } });
    });
  }

  /** Termine une saisie fusionnée (nom tapé au clavier). */
  seal(): void {
    this.history.seal();
  }

  // --- Lignes commerciales -----------------------------------------------------

  /** Ajoute une gare à la ligne en cours ; un autre nœud est refusé. */
  addStop(id: Id): void {
    const node = this.network.nodes[id];
    if (node?.kind !== 'station') {
      this.error = 'une ligne ne s’arrête qu’en gare';
      return;
    }
    this.error = null;
    if (this.lineDraft.at(-1) !== id) this.lineDraft = [...this.lineDraft, id];
  }

  removeLastStop(): void {
    this.lineDraft = this.lineDraft.slice(0, -1);
  }

  /** Crée la ligne à partir des gares cliquées, avec des réglages par défaut. */
  finishLine(): Id | null {
    const stops = [...this.lineDraft];
    if (stops.length < 2) {
      this.error = 'une ligne dessert au moins deux gares';
      return null;
    }
    const count = Object.keys(this.network.lines).length;
    const codes = Object.values(this.network.lines).map((l) => l.code);
    let n = count + 1;
    while (codes.includes(`L${n}`)) n++;
    const names = [stops[0], stops.at(-1)].map(
      (id) => this.network.nodes[id ?? '']?.name ?? 'Gare',
    );
    const input: LineInput = {
      name: `${names[0] ?? 'Gare'} – ${names[1] ?? 'Gare'}`,
      code: `L${n}`,
      color: LINE_COLORS[count % LINE_COLORS.length] ?? LINE_COLORS[0],
      stock: 'regional-electrique',
      stops,
      headwayMin: 60,
      firstDepartureMin: 6 * 60,
      lastDepartureMin: 22 * 60,
    };
    const created: { id: Id | null } = { id: null };
    this.execute('Créer une ligne', (network) => {
      const result = addLine(network, input);
      created.id = result.line.id;
      return result.network;
    });
    if (created.id) {
      this.lineDraft = [];
      this.activeLine = created.id;
      this.tool = 'select';
    }
    return created.id;
  }

  updateLine(id: Id, patch: Partial<LineInput>, mergeKey?: string): void {
    this.execute('Modifier la ligne', (network) => updateLine(network, id, patch), mergeKey);
  }

  removeLine(id: Id): void {
    this.execute('Supprimer la ligne', (network) => removeLine(network, id));
  }
}
