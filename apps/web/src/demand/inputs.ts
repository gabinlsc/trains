import type { DemandLine, DemandStation, Zone } from '@trains/engine';
import {
  departuresPerDay,
  rollingStockById,
  type Network,
  type RollingStockCategory,
} from '@trains/shared';
import type { Table } from '../map/layers/data.ts';
import { analyseLine } from '../editor/service.ts';

/**
 * Recette moyenne par voyageur-kilomètre selon la famille de matériel (€) :
 * ordres de grandeur des tarifs pratiqués, abonnements compris.
 */
export const FARE_PER_KM: Readonly<Record<RollingStockCategory, number>> = {
  'grande-vitesse': 0.11,
  intercites: 0.09,
  regional: 0.08,
  periurbain: 0.07,
  fret: 0,
};

/** Communes du pipeline converties en zones de demande. */
export function zonesFromTable(table: Table): Zone[] {
  const index = (name: string): number => {
    const i = table.fields.indexOf(name);
    if (i === -1) throw new Error(`colonne ${name} absente des communes`);
    return i;
  };
  const population = index('population');
  const lng = index('lng');
  const lat = index('lat');
  return table.rows.map((row) => ({
    population: Number(row[population]) || 0,
    position: [Number(row[lng]), Number(row[lat])],
  }));
}

/**
 * Gares et lignes circulables du réseau, sous la forme attendue par le
 * modèle de demande. Une ligne sans horaire (gares non reliées, matériel
 * incompatible) ne transporte personne.
 */
export function demandInputs(network: Network): {
  stations: DemandStation[];
  lines: DemandLine[];
} {
  const stations = Object.values(network.nodes)
    .filter((node) => node.kind === 'station')
    .map((node) => ({ id: node.id, position: node.position }));
  const lines: DemandLine[] = [];
  for (const line of Object.values(network.lines)) {
    const service = analyseLine(network, line);
    const stock = rollingStockById(line.stock);
    if (!service.stops || !stock) continue;
    const stops = service.stops;
    lines.push({
      id: line.id,
      stops: line.stops,
      // Du départ d'un arrêt au départ du suivant : l'arrêt intermédiaire compte.
      legTimesS: stops.slice(1).map((stop, i) => stop.departureS - (stops[i]?.departureS ?? 0)),
      legLengthsM: service.route.legs.map((leg) => leg?.lengthM ?? 0),
      headwayMin: line.headwayMin,
      farePerKm: FARE_PER_KM[stock.category],
      dailyCapacity: departuresPerDay(line) * stock.capacity,
    });
  }
  return { stations, lines };
}
