import { z } from 'zod';
import { roundPosition, type Position } from '../geo.ts';

const CommuneSchema = z.object({
  nom: z.string(),
  code: z.string().regex(/^[0-9][0-9AB][0-9]{3}$/),
  codeDepartement: z.string(),
  codeRegion: z.string().optional(),
  // Quelques communes « mortes pour la France » n'ont pas de population.
  population: z.number().int().nonnegative().optional(),
  centre: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) }),
});

const DepartementSchema = z.object({
  nom: z.string(),
  code: z.string(),
  codeRegion: z.string(),
  chefLieu: z.string(),
});

const RegionSchema = z.object({ nom: z.string(), code: z.string(), chefLieu: z.string() });

/** Tableau colonnaire : nettement plus compact qu'un tableau d'objets. */
export interface Table<Row extends readonly unknown[]> {
  fields: readonly string[];
  rows: Row[];
}

export type CommuneRow = [
  code: string,
  nom: string,
  dep: string,
  pop: number,
  lng: number,
  lat: number,
];

export interface AdminUnit {
  code: string;
  nom: string;
  region?: string;
  chefLieu: { code: string; nom: string; position: Position };
}

/** La France d'outre-mer n'est pas couverte par le jeu (DOM : 971 à 976). */
function isMetropolitan(departement: string): boolean {
  return !departement.startsWith('97');
}

export function buildCommunes(raw: unknown): Table<CommuneRow> {
  const communes = z.array(CommuneSchema).parse(raw);
  const rows = communes
    .filter((c) => isMetropolitan(c.codeDepartement))
    .map((c): CommuneRow => {
      const [lng, lat] = roundPosition(c.centre.coordinates);
      return [c.code, c.nom, c.codeDepartement, c.population ?? 0, lng, lat];
    })
    // Par population décroissante : les consommateurs tronquent facilement.
    .sort((a, b) => b[3] - a[3] || a[0].localeCompare(b[0]));
  return { fields: ['code', 'nom', 'departement', 'population', 'lng', 'lat'], rows };
}

function chefLieu(code: string, index: Map<string, CommuneRow>): AdminUnit['chefLieu'] {
  const commune = index.get(code);
  if (!commune) throw new Error(`Chef-lieu ${code} absent des communes`);
  return { code, nom: commune[1], position: [commune[4], commune[5]] };
}

export function buildAdminUnits(
  rawDepartements: unknown,
  rawRegions: unknown,
  communes: Table<CommuneRow>,
): { departements: AdminUnit[]; regions: AdminUnit[] } {
  const index = new Map(communes.rows.map((row) => [row[0], row]));
  const departements = z
    .array(DepartementSchema)
    .parse(rawDepartements)
    .filter((d) => isMetropolitan(d.code))
    .map((d) => ({
      code: d.code,
      nom: d.nom,
      region: d.codeRegion,
      chefLieu: chefLieu(d.chefLieu, index),
    }));
  const metropolitanRegions = new Set(departements.map((d) => d.region));
  const regions = z
    .array(RegionSchema)
    .parse(rawRegions)
    .filter((r) => metropolitanRegions.has(r.code))
    .map((r) => ({ code: r.code, nom: r.nom, chefLieu: chefLieu(r.chefLieu, index) }));
  return { departements, regions };
}
