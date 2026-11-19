import { addLine, addNode, addSegment, EMPTY_NETWORK } from '@trains/shared';
import { describe, expect, it } from 'vitest';
import { demandInputs, FARE_PER_KM, zonesFromTable } from './inputs.ts';

describe('entrées de la demande', () => {
  it('lit les communes du pipeline', () => {
    const zones = zonesFromTable({
      fields: ['code', 'nom', 'departement', 'population', 'lng', 'lat'],
      rows: [
        ['75056', 'Paris', '75', 2103778, 2.347, 48.8589],
        ['97101', 'Sans population', '971', null, -61.5, 16.2],
      ],
    });
    expect(zones).toEqual([
      { population: 2103778, position: [2.347, 48.8589] },
      { population: 0, position: [-61.5, 16.2] },
    ]);
    expect(() => zonesFromTable({ fields: ['nom'], rows: [] })).toThrow(/population/);
  });

  it('ne retient que les lignes circulables, avec leurs temps et leur offre', () => {
    const station = { type: 'gare' as const, platforms: 2, terminus: false };
    let n = EMPTY_NETWORK;
    n = addNode(n, [2, 47], { id: 'n_aaaaaa', station }).network;
    n = addNode(n, [2.4, 47], { id: 'n_bbbbbb', station }).network;
    n = addNode(n, [2.8, 47], { id: 'n_cccccc', station }).network;
    n = addSegment(n, 'n_aaaaaa', 'n_bbbbbb', { id: 's_aaaaaa' }).network;
    const base = {
      name: 'x',
      code: 'X',
      color: '#0072ce',
      stock: 'regional-electrique',
      headwayMin: 60,
      firstDepartureMin: 360,
      lastDepartureMin: 1320,
    };
    n = addLine(n, { ...base, stops: ['n_aaaaaa', 'n_bbbbbb'] }, { id: 'l_aaaaaa' }).network;
    // Gare C non reliée : pas d'horaire, la ligne ne transporte personne.
    n = addLine(n, { ...base, stops: ['n_bbbbbb', 'n_cccccc'] }, { id: 'l_bbbbbb' }).network;
    const { stations, lines } = demandInputs(n);
    expect(stations.map((s) => s.id)).toEqual(['n_aaaaaa', 'n_bbbbbb', 'n_cccccc']);
    expect(lines.map((l) => l.id)).toEqual(['l_aaaaaa']);
    const line = lines[0];
    expect(line?.legTimesS[0]).toBeGreaterThan(600);
    expect(line?.legLengthsM[0]).toBeCloseTo(30_400, -3);
    expect(line?.farePerKm).toBe(FARE_PER_KM.regional);
    expect(line?.dailyCapacity).toBe(17 * 380);
  });
});
