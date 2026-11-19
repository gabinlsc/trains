/// <reference lib="webworker" />
import { computeDemand, type DemandLine, type DemandStation, type Zone } from '@trains/engine';

/**
 * Calcul de la demande hors du fil principal : plusieurs dizaines de
 * milliers de communes croisées avec les gares, puis une affectation par
 * gare d'origine, ne doivent pas figer la carte.
 */
export type DemandRequest =
  | { type: 'zones'; zones: Zone[] }
  | { type: 'compute'; id: number; stations: DemandStation[]; lines: DemandLine[] };

export interface DemandResponse {
  type: 'result';
  id: number;
  result: ReturnType<typeof computeDemand>;
}

let zones: Zone[] = [];

self.onmessage = (event: MessageEvent<DemandRequest>) => {
  const message = event.data;
  if (message.type === 'zones') {
    zones = message.zones;
    return;
  }
  const result = computeDemand(zones, message.stations, message.lines);
  const response: DemandResponse = { type: 'result', id: message.id, result };
  self.postMessage(response);
};
