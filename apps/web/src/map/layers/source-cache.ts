import type { FeatureCollection } from 'geojson';

/**
 * Cache des données des calques, volontairement non réactif : l'interface
 * n'a besoin que du statut, pas des milliers d'objets chargés.
 */
export class SourceCache {
  private readonly pending = new Map<string, Promise<FeatureCollection>>();
  private readonly loaded = new Map<string, FeatureCollection>();
  /** Sources du style courant déjà alimentées : évite de recharger 5 Mo à chaque bascule. */
  private readonly applied = new Set<string>();

  /** Charge une seule fois par clé ; un échec est oublié pour permettre une relance. */
  async load(key: string, loader: () => Promise<FeatureCollection>): Promise<FeatureCollection> {
    let promise = this.pending.get(key);
    if (!promise) {
      promise = loader();
      this.pending.set(key, promise);
    }
    try {
      const data = await promise;
      this.loaded.set(key, data);
      return data;
    } catch (error) {
      this.pending.delete(key);
      throw error;
    }
  }

  get(key: string): FeatureCollection | undefined {
    return this.loaded.get(key);
  }

  /** Nouveau style : toutes ses sources sont à réalimenter. */
  resetApplied(): void {
    this.applied.clear();
  }

  isApplied(key: string): boolean {
    return this.applied.has(key);
  }

  markApplied(key: string): void {
    this.applied.add(key);
  }
}
