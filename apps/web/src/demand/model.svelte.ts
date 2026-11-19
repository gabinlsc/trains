import type { DemandResult } from '@trains/engine';
import type { Network } from '@trains/shared';
import { loadDataFile, type Table } from '../map/layers/data.ts';
import { debounce } from '../storage/projects.ts';
import type { DemandRequest, DemandResponse } from './demand.worker.ts';
import { demandInputs, zonesFromTable } from './inputs.ts';
import { createDemandWorker } from './worker.ts';

export type DemandStatus = 'idle' | 'loading' | 'computing' | 'ready' | 'unavailable';

/**
 * Demande du réseau courant, recalculée dans un worker après chaque
 * modification. Sans données de communes, la demande reste indisponible
 * et le reste de l'éditeur fonctionne normalement.
 */
export class DemandModel {
  status = $state<DemandStatus>('idle');
  result = $state.raw<DemandResult | null>(null);
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private latest = 0;
  private readonly schedule = debounce((network: Network) => {
    void this.compute(network);
  }, 400);

  private start(): Promise<boolean> {
    this.ready ??= (async () => {
      this.status = 'loading';
      try {
        const table = await loadDataFile<Table>('communes.json');
        this.worker = createDemandWorker();
        this.worker.onmessage = (event: MessageEvent<DemandResponse>) => {
          // Seul le dernier calcul demandé compte.
          if (event.data.id !== this.latest) return;
          this.result = event.data.result;
          this.status = 'ready';
        };
        const message: DemandRequest = { type: 'zones', zones: zonesFromTable(table) };
        this.worker.postMessage(message);
        return true;
      } catch {
        this.status = 'unavailable';
        return false;
      }
    })();
    return this.ready;
  }

  /** Demande un recalcul, regroupé avec les modifications rapprochées. */
  update(network: Network): void {
    if (Object.keys(network.lines).length === 0) {
      this.schedule.cancel();
      this.latest++;
      this.result = null;
      if (this.status === 'ready' || this.status === 'computing') this.status = 'idle';
      return;
    }
    this.schedule(network);
  }

  private async compute(network: Network): Promise<void> {
    if (!(await this.start()) || !this.worker) return;
    const id = ++this.latest;
    this.status = 'computing';
    const message: DemandRequest = { type: 'compute', id, ...demandInputs(network) };
    this.worker.postMessage(message);
  }

  dispose(): void {
    this.schedule.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
