import { addNode, addSegment, DEFAULT_TRACK_SPEC, EMPTY_NETWORK, updateNode } from '@trains/shared';
import { describe, expect, it } from 'vitest';
import {
  addCosts,
  CONTINGENCY_RATE,
  earthworkDepth,
  junctionCost,
  maintenanceCost,
  networkCost,
  segmentCost,
  stationCost,
  trackCostPerKm,
} from './costs.ts';

const LGV = { ...DEFAULT_TRACK_SPEC, designSpeedKmh: 320, signalling: 'ertms2' as const };

describe('coûts unitaires', () => {
  it('interpole le coût de la voie selon la vitesse et prolonge au-delà', () => {
    expect(trackCostPerKm(60)).toBe(4);
    expect(trackCostPerKm(160)).toBe(6);
    expect(trackCostPerKm(190)).toBeCloseTo(8);
    expect(trackCostPerKm(320)).toBe(16);
    expect(trackCostPerKm(350)).toBeCloseTo(17.8);
  });

  it('chiffre une LGV de 100 km dans l’ordre de grandeur constaté', () => {
    const cost = segmentCost({ lengthM: 100_000, spec: LGV, earthworkDepthM: 5 });
    // LGV récentes : 20 à 30 M€/km tout compris, hors grands ouvrages.
    expect(cost.total / 100).toBeGreaterThan(18);
    expect(cost.total / 100).toBeLessThan(30);
    expect(cost.contingency).toBeCloseTo((cost.total * CONTINGENCY_RATE) / (1 + CONTINGENCY_RATE));
  });

  it('remplace la voie courante par les ouvrages, plus chers', () => {
    const plain = segmentCost({ lengthM: 10_000, spec: DEFAULT_TRACK_SPEC });
    const tunnel = segmentCost({
      lengthM: 10_000,
      spec: DEFAULT_TRACK_SPEC,
      structures: [{ kind: 'tunnel', lengthM: 4000 }],
    });
    expect(tunnel.track).toBeCloseTo(plain.track * 0.6);
    expect(tunnel.structures).toBeCloseTo(180);
    expect(tunnel.electrification).toBe(plain.electrification);
    expect(tunnel.total).toBeGreaterThan(plain.total * 3);
  });

  it('module selon le nombre de voies, l’écartement et les équipements', () => {
    const base = segmentCost({ lengthM: 1000, spec: DEFAULT_TRACK_SPEC });
    const single = segmentCost({ lengthM: 1000, spec: { ...DEFAULT_TRACK_SPEC, tracks: 1 } });
    const metre = segmentCost({
      lengthM: 1000,
      spec: { ...DEFAULT_TRACK_SPEC, gauge: 'metre', electrification: 'none', signalling: 'bapr' },
    });
    expect(single.total).toBeCloseTo(base.total * 0.6);
    expect(metre.track).toBeCloseTo(base.track * 0.75);
    expect(metre.electrification).toBe(0);
    expect(metre.signalling).toBeLessThan(base.signalling);
  });

  it('chiffre gares et bifurcations', () => {
    expect(stationCost({ type: 'halte', platforms: 2, terminus: false })).toBe(1.5);
    expect(stationCost({ type: 'tgv', platforms: 6, terminus: false })).toBe(70);
    expect(
      stationCost({ type: 'tgv', platforms: 6, terminus: false, existingUic: '87686006' }),
    ).toBeCloseTo(28);
    expect(junctionCost()).toBe(4);
    expect(junctionCost(true)).toBe(24);
  });
});

describe('coût d’un réseau', () => {
  it('additionne tronçons, gares et bifurcations', () => {
    let n = EMPTY_NETWORK;
    n = addNode(n, [2, 47], {
      id: 'n_aaaaaa',
      station: { type: 'gare', platforms: 2, terminus: false },
    }).network;
    n = addNode(n, [2.1, 47], { id: 'n_bbbbbb' }).network;
    n = addNode(n, [2.2, 47], { id: 'n_cccccc' }).network;
    n = addNode(n, [2.1, 47.1], { id: 'n_dddddd' }).network;
    n = addSegment(n, 'n_aaaaaa', 'n_bbbbbb', { id: 's_aaaaaa' }).network;
    n = addSegment(n, 'n_bbbbbb', 'n_cccccc', { id: 's_bbbbbb' }).network;
    n = addSegment(n, 'n_bbbbbb', 'n_dddddd', { id: 's_cccccc' }).network;
    n = updateNode(n, 'n_bbbbbb', { flyover: true });
    const cost = networkCost(n, () => ({ lengthM: 5000 }));
    const one = segmentCost({ lengthM: 5000, spec: DEFAULT_TRACK_SPEC });
    expect(cost.stations).toBe(9);
    expect(cost.junctions).toBe(24);
    expect(cost.track).toBeCloseTo(one.track * 3);
    expect(cost.total).toBeCloseTo((one.total / 1.15) * 3 * 1.15 + (9 + 24) * 1.15);
    expect(addCosts(cost).total).toBeCloseTo(cost.total);
  });

  it('estime un entretien annuel de l’ordre du pour cent de l’investissement', () => {
    const cost = segmentCost({ lengthM: 50_000, spec: LGV });
    const rate = maintenanceCost(cost) / cost.total;
    expect(rate).toBeGreaterThan(0.008);
    expect(rate).toBeLessThan(0.03);
  });
});

describe('terrassements', () => {
  it('moyenne l’écart voie/terrain hors ouvrages', () => {
    const distance = [0, 100, 200, 300];
    const terrain = [100, 110, 150, 100];
    const track = [100, 104, 108, 104];
    expect(earthworkDepth(terrain, track)).toBeCloseTo((0 + 6 + 42 + 4) / 4);
    expect(earthworkDepth(terrain, track, [{ from: 150, to: 250 }], distance)).toBeCloseTo(10 / 3);
    expect(earthworkDepth([], [])).toBe(0);
  });
});
