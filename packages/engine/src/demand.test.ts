import { describe, expect, it } from 'vitest';
import {
  carCost,
  catchments,
  computeDemand,
  railShare,
  type DemandLine,
  type Zone,
} from './demand.ts';
import { haversineDistance, type LngLat } from './geo.ts';

const PARIS: LngLat = [2.3522, 48.8566];
const LYON: LngLat = [4.8357, 45.764];
const DIJON: LngLat = [5.0415, 47.322];
const FAR: LngLat = [-1.5536, 47.2184];

const ZONES: Zone[] = [
  { population: 6_500_000, position: PARIS },
  // Banlieue à 10 km : rabattue sur Paris.
  { population: 2_000_000, position: [2.35, 48.95] },
  { population: 1_660_000, position: LYON },
  { population: 160_000, position: DIJON },
  { population: 320_000, position: FAR },
];

const STATIONS = [
  { id: 'paris', position: PARIS },
  { id: 'lyon', position: LYON },
  { id: 'dijon', position: DIJON },
  { id: 'nantes', position: FAR },
];

function line(id: string, stops: string[], minutesPerKm: number, headwayMin = 60): DemandLine {
  const positions = new Map(STATIONS.map((s) => [s.id, s.position]));
  const lengths = stops
    .slice(1)
    .map((stop, i) =>
      haversineDistance(positions.get(stops[i] as string) as LngLat, positions.get(stop) as LngLat),
    );
  return {
    id,
    stops,
    legLengthsM: lengths,
    legTimesS: lengths.map((m) => (m / 1000) * minutesPerKm * 60),
    headwayMin,
    farePerKm: 0.11,
    dailyCapacity: 20_000,
  };
}

describe('rabattement', () => {
  it('rattache chaque commune à la gare la plus proche dans le rayon', () => {
    const area = catchments(ZONES, STATIONS);
    expect(area.get('paris')?.population).toBe(8_500_000);
    expect(area.get('paris')?.accessMin).toBeGreaterThan(5);
    expect(area.get('lyon')?.population).toBe(1_660_000);
    expect(catchments(ZONES, [{ id: 'x', position: [0, 0] }]).get('x')?.population).toBe(0);
  });
});

describe('partage modal', () => {
  it('donne la moitié du marché à coût égal et l’essentiel quand le train est deux fois plus rapide', () => {
    expect(railShare(100, 100)).toBeCloseTo(0.5);
    expect(railShare(120, 240)).toBeGreaterThan(0.7);
    expect(railShare(400, 200)).toBeLessThan(0.1);
    expect(railShare(Infinity, 100)).toBe(0);
  });

  it('chiffre la voiture en temps et en argent', () => {
    // 400 km à vol d'oiseau : 520 km de route, ≈ 5 h 20, et 104 € de frais
    // partagés entre 1,6 occupants.
    expect(carCost(400_000)).toBeCloseTo(312 + 10 + (65 * 60) / 25, 0);
    expect(carCost(5_000)).toBeLessThan(40);
  });
});

describe('demande et affectation', () => {
  it('produit un trafic Paris – Lyon de l’ordre de 25 000 voyageurs par jour', () => {
    // LGV : 0,25 min/km, soit 240 km/h de moyenne.
    const result = computeDemand(ZONES, STATIONS, [line('lgv', ['paris', 'lyon'], 0.25, 30)]);
    expect(result.railTripsPerDay).toBeGreaterThan(15_000);
    expect(result.railTripsPerDay).toBeLessThan(40_000);
    expect(result.railTripsPerDay).toBeLessThan(result.marketTripsPerDay);
    const lgv = result.lines.lgv;
    expect(lgv?.tripsPerDay).toBeCloseTo(result.railTripsPerDay);
    expect(lgv?.revenueM).toBeGreaterThan(0);
    expect(result.boardings.paris).toBeGreaterThan(0);
    expect(result.topPairs[0]).toMatchObject({ from: 'lyon', to: 'paris' });
  });

  it('attire davantage avec une ligne plus rapide et plus fréquente', () => {
    const slow = computeDemand(ZONES, STATIONS, [line('l', ['paris', 'lyon'], 0.6, 120)]);
    const fast = computeDemand(ZONES, STATIONS, [line('l', ['paris', 'lyon'], 0.25, 30)]);
    expect(fast.railTripsPerDay).toBeGreaterThan(slow.railTripsPerDay * 1.25);
  });

  it('achemine avec correspondance et ignore les gares non reliées', () => {
    const result = computeDemand(
      ZONES,
      STATIONS,
      [
        line('a', ['paris', 'dijon'], 0.3),
        line('b', ['dijon', 'lyon'], 0.3),
        line('c', ['nantes', 'nantes-bis'].slice(0, 1).concat('nantes'), 0.3),
      ].slice(0, 2),
    );
    const viaDijon = result.topPairs.find((p) => p.from === 'lyon' && p.to === 'paris');
    expect(viaDijon?.tripsPerDay).toBeGreaterThan(0);
    // Le trafic Paris – Lyon charge les deux lignes.
    expect(result.lines.a?.tripsPerDay).toBeGreaterThan(viaDijon?.tripsPerDay ?? 0);
    expect(result.lines.b?.tripsPerDay).toBeGreaterThan(viaDijon?.tripsPerDay ?? 0);
    expect(result.boardings.nantes).toBeUndefined();
    expect(result.lines.a?.peakLoadFactor).toBeGreaterThan(0);
  });
});
