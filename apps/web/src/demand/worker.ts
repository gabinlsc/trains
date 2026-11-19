/** Worker de la demande ; Vite le compile en module séparé, servi depuis /assets. */
export function createDemandWorker(): Worker {
  return new Worker(new URL('./demand.worker.ts', import.meta.url), { type: 'module' });
}
