import type { Position } from '../geo.ts';

/**
 * Grandes villes frontalières reliées ou reliables au réseau français.
 * Population de la commune (ville centre), arrondie au millier, d'après les
 * offices statistiques nationaux (Statbel, OFS, STATEC, ISTAT, INE, ONS,
 * Destatis), dernières valeurs publiées. Coordonnées : gare principale.
 */
export interface ForeignCity {
  id: string;
  nom: string;
  pays: string;
  population: number;
  position: Position;
}

export const FOREIGN_CITIES: readonly ForeignCity[] = [
  { id: 'london', nom: 'Londres', pays: 'GB', population: 8_946_000, position: [-0.1263, 51.5309] },
  {
    id: 'bruxelles',
    nom: 'Bruxelles',
    pays: 'BE',
    population: 1_250_000,
    position: [4.3355, 50.8355],
  },
  { id: 'liege', nom: 'Liège', pays: 'BE', population: 197_000, position: [5.5668, 50.6245] },
  {
    id: 'luxembourg',
    nom: 'Luxembourg',
    pays: 'LU',
    population: 135_000,
    position: [6.1336, 49.6001],
  },
  {
    id: 'sarrebruck',
    nom: 'Sarrebruck',
    pays: 'DE',
    population: 181_000,
    position: [6.9912, 49.2411],
  },
  {
    id: 'karlsruhe',
    nom: 'Karlsruhe',
    pays: 'DE',
    population: 309_000,
    position: [8.4017, 48.9935],
  },
  {
    id: 'fribourg',
    nom: 'Fribourg-en-Brisgau',
    pays: 'DE',
    population: 237_000,
    position: [7.8412, 47.9977],
  },
  { id: 'bale', nom: 'Bâle', pays: 'CH', population: 177_000, position: [7.5895, 47.5476] },
  { id: 'lausanne', nom: 'Lausanne', pays: 'CH', population: 144_000, position: [6.6292, 46.5167] },
  { id: 'geneve', nom: 'Genève', pays: 'CH', population: 205_000, position: [6.1424, 46.2102] },
  { id: 'turin', nom: 'Turin', pays: 'IT', population: 841_000, position: [7.6784, 45.0624] },
  {
    id: 'vintimille',
    nom: 'Vintimille',
    pays: 'IT',
    population: 23_000,
    position: [7.6152, 43.7918],
  },
  {
    id: 'barcelone',
    nom: 'Barcelone',
    pays: 'ES',
    population: 1_686_000,
    position: [2.1403, 41.3791],
  },
  {
    id: 'saint-sebastien',
    nom: 'Saint-Sébastien',
    pays: 'ES',
    population: 189_000,
    position: [-1.9786, 43.3178],
  },
];
