import {
  addLine,
  addNode,
  addSegment,
  EMPTY_NETWORK,
  type Line,
  type Network,
} from '@trains/shared';
import { describe, expect, it } from 'vitest';
import { analyseLine, clockTime, formatDuration } from './service.ts';

function network(electrification: 'ac25k' | 'none' = 'ac25k'): Network {
  const station = { type: 'gare' as const, platforms: 2, terminus: false };
  let n = EMPTY_NETWORK;
  n = addNode(n, [2, 47], { id: 'n_aaaaaa', station }).network;
  n = addNode(n, [2.4, 47], { id: 'n_bbbbbb', station }).network;
  n = addNode(n, [2.8, 47], { id: 'n_cccccc', station }).network;
  const spec = {
    tracks: 2 as const,
    gauge: 'standard' as const,
    electrification,
    signalling: 'bal' as const,
    designSpeedKmh: 160,
  };
  n = addSegment(n, 'n_aaaaaa', 'n_bbbbbb', { id: 's_aaaaaa', spec }).network;
  n = addSegment(n, 'n_cccccc', 'n_bbbbbb', { id: 's_bbbbbb', spec }).network;
  return addLine(
    n,
    {
      name: 'Test',
      code: 'T1',
      color: '#0072ce',
      stock: 'regional-electrique',
      stops: ['n_aaaaaa', 'n_bbbbbb', 'n_cccccc'],
      headwayMin: 60,
      firstDepartureMin: 6 * 60,
      lastDepartureMin: 22 * 60,
    },
    { id: 'l_aaaaaa' },
  ).network;
}

function lineOf(n: Network): Line {
  const line = n.lines.l_aaaaaa;
  if (!line) throw new Error('ligne absente');
  return line;
}

describe('exploitation d’une ligne', () => {
  it('calcule horaire, vitesse moyenne, parc et coûts', () => {
    const n = network();
    const service = analyseLine(n, lineOf(n));
    // Deux intervalles d'environ 30 km à 160 km/h, un arrêt de 90 s.
    expect(service.tripS).toBeGreaterThan(1500);
    expect(service.tripS).toBeLessThan(1800);
    expect(service.stops?.[1]?.departureS).toBeCloseTo((service.stops?.[1]?.arrivalS ?? 0) + 90);
    expect(service.averageKmh).toBeGreaterThan(100);
    expect(service.averageKmh).toBeLessThan(140);
    expect(service.fleet).toBe(2);
    expect(service.fleetCostM).toBe(20);
    // 17 départs × 2 sens × ≈ 61 km × 365 j × 10 €.
    expect(service.operatingCostM).toBeGreaterThan(7);
    expect(service.operatingCostM).toBeLessThan(8.2);
  });

  it('n’établit pas d’horaire sous un matériel incompatible ou sur un réseau coupé', () => {
    const n = network('none');
    expect(analyseLine(n, lineOf(n)).stops).toBeNull();
    const cut = network();
    const { s_bbbbbb: _removed, ...segments } = cut.segments;
    const broken = { ...cut, segments };
    const service = analyseLine(broken, lineOf(broken));
    expect(service.route.ok).toBe(false);
    expect(service.tripS).toBeNull();
  });

  it('formate durées et heures de passage', () => {
    expect(formatDuration(42 * 60)).toBe('42 min');
    expect(formatDuration(65 * 60 + 20)).toBe('1 h 05');
    expect(clockTime(6 * 60, 0)).toBe('06:00');
    expect(clockTime(23 * 60 + 50, 20 * 60)).toBe('00:10');
  });
});
