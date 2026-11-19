import {
  avoidedEmissionsT,
  maintenanceCost,
  networkCost,
  polylineLength,
  type DemandResult,
} from '@trains/engine';
import { rollingStockById, type Network } from '@trains/shared';
import { smoothedPath } from '../editor/geometry.ts';
import { analyseLine } from '../editor/service.ts';

const DAYS = 365;

export interface NetworkKpis {
  trackKm: number;
  stations: number;
  lines: number;
  /** Investissement en infrastructure (M€, hors ouvrages d'art non calculés). */
  capexM: number;
  maintenanceM: number;
  fleet: number;
  fleetCostM: number;
  operatingM: number;
  /** Valeurs issues de la demande ; null tant qu'elle n'est pas calculée. */
  tripsPerDay: number | null;
  passengerKmPerYear: number | null;
  revenueM: number | null;
  /** Recettes moins exploitation et entretien (M€/an). */
  balanceM: number | null;
  co2AvoidedT: number | null;
}

/** Indicateurs du réseau : infrastructure, exploitation, fréquentation, climat. */
export function networkKpis(network: Network, demand: DemandResult | null): NetworkKpis {
  const lengths = new Map<string, number>();
  let trackM = 0;
  for (const segment of Object.values(network.segments)) {
    const length = polylineLength(smoothedPath(network, segment));
    lengths.set(segment.id, length);
    trackM += length;
  }
  const capex = networkCost(network, (id) => ({ lengthM: lengths.get(id) ?? 0 }));
  let fleet = 0;
  let fleetCostM = 0;
  let operatingM = 0;
  let pkmPerDay = 0;
  let revenueM = 0;
  let co2 = 0;
  for (const line of Object.values(network.lines)) {
    const service = analyseLine(network, line);
    fleet += service.fleet ?? 0;
    fleetCostM += service.fleetCostM ?? 0;
    operatingM += service.operatingCostM ?? 0;
    const load = demand?.lines[line.id];
    const stock = rollingStockById(line.stock);
    if (load && stock) {
      pkmPerDay += load.passengerKmPerDay;
      revenueM += load.revenueM;
      co2 += avoidedEmissionsT(load.passengerKmPerDay * DAYS, stock.traction);
    }
  }
  const maintenanceM = maintenanceCost(capex);
  return {
    trackKm: trackM / 1000,
    stations: Object.values(network.nodes).filter((n) => n.kind === 'station').length,
    lines: Object.keys(network.lines).length,
    capexM: capex.total,
    maintenanceM,
    fleet,
    fleetCostM,
    operatingM,
    tripsPerDay: demand ? demand.railTripsPerDay : null,
    passengerKmPerYear: demand ? pkmPerDay * DAYS : null,
    revenueM: demand ? revenueM : null,
    balanceM: demand ? revenueM - operatingM - maintenanceM : null,
    co2AvoidedT: demand ? co2 : null,
  };
}
