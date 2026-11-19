import type { DemandResult } from '@trains/engine';
import { addLine, addNode, addSegment, EMPTY_NETWORK, type Network } from '@trains/shared';
import { describe, expect, it } from 'vitest';
import { networkKpis } from './kpis.ts';

function network(): Network {
  const station = { type: 'gare' as const, platforms: 2, terminus: false };
  let n = EMPTY_NETWORK;
  n = addNode(n, [2, 47], { id: 'n_aaaaaa', station }).network;
  n = addNode(n, [2.4, 47], { id: 'n_bbbbbb', station }).network;
  n = addSegment(n, 'n_aaaaaa', 'n_bbbbbb', { id: 's_aaaaaa' }).network;
  return addLine(
    n,
    {
      name: 'x',
      code: 'X',
      color: '#0072ce',
      stock: 'regional-electrique',
      stops: ['n_aaaaaa', 'n_bbbbbb'],
      headwayMin: 60,
      firstDepartureMin: 360,
      lastDepartureMin: 1320,
    },
    { id: 'l_aaaaaa' },
  ).network;
}

const DEMAND = {
  railTripsPerDay: 2000,
  marketTripsPerDay: 5000,
  lines: {
    l_aaaaaa: { tripsPerDay: 2000, passengerKmPerDay: 60_000, revenueM: 1.75, peakLoadFactor: 0.2 },
  },
  boardings: {},
  catchments: {},
  topPairs: [],
  matrix: { stations: [], minutes: [] },
} satisfies DemandResult;

describe('indicateurs du réseau', () => {
  it('additionne infrastructure et exploitation, sans demande', () => {
    const kpis = networkKpis(network(), null);
    expect(kpis.trackKm).toBeCloseTo(30.4, 0);
    expect(kpis.stations).toBe(2);
    expect(kpis.lines).toBe(1);
    expect(kpis.capexM).toBeGreaterThan(200);
    expect(kpis.maintenanceM).toBeGreaterThan(0);
    // Aller de 15 min : cycle de 50 min avec les battements, une rame suffit.
    expect(kpis.fleet).toBe(1);
    expect(kpis.tripsPerDay).toBeNull();
    expect(kpis.balanceM).toBeNull();
  });

  it('dresse le bilan annuel et les émissions évitées avec la demande', () => {
    const kpis = networkKpis(network(), DEMAND);
    expect(kpis.tripsPerDay).toBe(2000);
    expect(kpis.passengerKmPerYear).toBe(60_000 * 365);
    expect(kpis.revenueM).toBe(1.75);
    expect(kpis.balanceM).toBeCloseTo(1.75 - kpis.operatingM - kpis.maintenanceM);
    // 21,9 M voyageurs-km × 0,125 kg évités.
    expect(kpis.co2AvoidedT).toBeCloseTo(2737.5, 0);
  });
});
