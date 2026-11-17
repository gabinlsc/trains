import type { FeatureCollection } from 'geojson';
import type { SourceSpecification } from 'maplibre-gl';

/**
 * Cache des données des calques, volontairement non réactif : l'interface
 * n'a besoin que du statut, pas des milliers d'objets chargés.
 */
export class SourceCache {
  private readonly pending = new Map<string, Promise<FeatureCollection>>();
  private readonly loaded = new Map<string, FeatureCollection>();
  /** Sources du style courant déjà alimentées : évite de recharger 5 Mo à chaque bascule. */
  private readonly applied = new Set<string>();

  private readonly specs = new Map<string, Promise<Record<string, SourceSpecification>>>();
  private readonly resolvedSpecs = new Map<string, Record<string, SourceSpecification>>();

  /** Spécifications de sources différées (relief), résolues une seule fois par clé. */
  async loadSpecs(
    key: string,
    loader: () => Promise<Record<string, SourceSpecification>>,
  ): Promise<Record<string, SourceSpecification>> {
    let promise = this.specs.get(key);
    if (!promise) {
      promise = loader();
      this.specs.set(key, promise);
    }
    try {
      const specs = await promise;
      this.resolvedSpecs.set(key, specs);
      return specs;
    } catch (error) {
      this.specs.delete(key);
      throw error;
    }
  }

  getSpecs(key: string): Record<string, SourceSpecification> | undefined {
    return this.resolvedSpecs.get(key);
  }

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
