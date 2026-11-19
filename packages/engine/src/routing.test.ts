import { addNode, addSegment, EMPTY_NETWORK, type Network } from '@trains/shared';
import { describe, expect, it } from 'vitest';
import { lineRoute, routeSegments, shortestPath } from './routing.ts';

/**
 * A ─ B ─ C, et un détour A ─ D ─ C plus long ; E isolé.
 */
function network(): Network {
  let n = EMPTY_NETWORK;
  const station = { type: 'gare' as const, platforms: 2, terminus: false };
  n = addNode(n, [2, 47], { id: 'n_aaaaaa', station }).network;
  n = addNode(n, [2.1, 47], { id: 'n_bbbbbb', station }).network;
  n = addNode(n, [2.2, 47], { id: 'n_cccccc', station }).network;
  n = addNode(n, [2.1, 47.3], { id: 'n_dddddd' }).network;
  n = addNode(n, [3, 48], { id: 'n_eeeeee', station }).network;
  n = addSegment(n, 'n_aaaaaa', 'n_bbbbbb', { id: 's_ab0000' }).network;
  n = addSegment(n, 'n_cccccc', 'n_bbbbbb', { id: 's_cb0000' }).network;
  n = addSegment(n, 'n_aaaaaa', 'n_dddddd', { id: 's_ad0000' }).network;
  n = addSegment(n, 'n_dddddd', 'n_cccccc', { id: 's_dc0000' }).network;
  return n;
}

describe('itinéraires', () => {
  it('prend le plus court chemin et note le sens de parcours', () => {
    const leg = shortestPath(network(), 'n_aaaaaa', 'n_cccccc');
    expect(leg?.steps).toEqual([
      { segment: 's_ab0000', reversed: false },
      { segment: 's_cb0000', reversed: true },
    ]);
    expect(leg?.lengthM).toBeCloseTo(15_200, -2);
    expect(shortestPath(network(), 'n_aaaaaa', 'n_aaaaaa')?.steps).toEqual([]);
  });

  it('suit le détour quand on le force par la longueur', () => {
    const n = network();
    const leg = shortestPath(n, 'n_aaaaaa', 'n_cccccc', (s) => (s.id === 's_ab0000' ? 1e9 : 1));
    expect(leg?.steps.map((s) => s.segment)).toEqual(['s_ad0000', 's_dc0000']);
  });

  it('assemble une ligne et signale les arrêts non reliés', () => {
    const n = network();
    const route = lineRoute(n, { stops: ['n_aaaaaa', 'n_bbbbbb', 'n_cccccc'] });
    expect(route.ok).toBe(true);
    expect(routeSegments(route).map((s) => s.segment)).toEqual(['s_ab0000', 's_cb0000']);
    const broken = lineRoute(n, { stops: ['n_aaaaaa', 'n_cccccc', 'n_eeeeee'] });
    expect(broken.ok).toBe(false);
    expect(broken.unreachable).toEqual([1]);
    expect(broken.legs[1]).toBeNull();
    expect(broken.lengthM).toBeCloseTo(route.lengthM, -2);
  });
});
