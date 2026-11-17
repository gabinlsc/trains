import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ElevationGrid } from '@trains/engine';
import { readDataStatus } from './data-status.ts';

/**
 * Grille d'altitude en mémoire (48 Mo), chargée au premier besoin et
 * rechargée quand une nouvelle génération de données est publiée. Les
 * requêtes simultanées partagent le même chargement.
 */
export class ElevationStore {
  private readonly dataDir: string;
  private cached: { version: string; grid: ElevationGrid } | null = null;
  private loading: Promise<ElevationGrid | null> | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async get(): Promise<ElevationGrid | null> {
    const status = await readDataStatus(this.dataDir);
    if (status.status !== 'ok') return null;
    if (this.cached?.version === status.version) return this.cached.grid;
    this.loading ??= this.load(status.version).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(version: string): Promise<ElevationGrid | null> {
    try {
      const bytes = await readFile(join(this.dataDir, 'data', version, 'altitude.bin'));
      const grid = ElevationGrid.decode(
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
      this.cached = { version, grid };
      return grid;
    } catch {
      // Génération sans grille ou fichier corrompu : le profil est indisponible.
      return null;
    }
  }
}
