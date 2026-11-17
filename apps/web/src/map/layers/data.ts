import type { FeatureCollection, Point } from 'geojson';

/**
 * Accès aux données publiées par le pipeline. Le manifeste courant (jamais en
 * cache) donne la version ; les fichiers sont ensuite lus sous
 * /data/<version>/, servis avec un cache permanent.
 */
export interface Manifest {
  dataVersion: string;
  outputs: { file: string }[];
}

let manifestPromise: Promise<Manifest> | null = null;

export function loadManifest(fetchImpl: typeof fetch = fetch): Promise<Manifest> {
  manifestPromise ??= fetchImpl('/data/current/manifest.json').then(async (response) => {
    if (!response.ok) throw new Error(`manifeste indisponible (HTTP ${response.status})`);
    const manifest = (await response.json()) as Manifest;
    if (typeof manifest.dataVersion !== 'string') throw new Error('manifeste invalide');
    return manifest;
  });
  // Un échec ne doit pas être mémorisé : la tentative suivante réessaie.
  manifestPromise.catch(() => {
    manifestPromise = null;
  });
  return manifestPromise;
}

/** Réinitialise le cache du manifeste (tests). */
export function resetManifestCache(): void {
  manifestPromise = null;
}

export async function loadDataFile<T>(file: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const manifest = await loadManifest(fetchImpl);
  if (!manifest.outputs.some((o) => o.file === file)) {
    throw new Error(`${file} absent de la génération ${manifest.dataVersion}`);
  }
  const response = await fetchImpl(`/data/${manifest.dataVersion}/${file}`);
  if (!response.ok) throw new Error(`${file} indisponible (HTTP ${response.status})`);
  return (await response.json()) as T;
}

/** Tableau colonnaire produit par le pipeline. */
export interface Table {
  fields: string[];
  rows: unknown[][];
}

/**
 * Convertit un tableau colonnaire en points GeoJSON. Les colonnes `lng` et
 * `lat` donnent la position ; les autres deviennent des propriétés.
 */
export function tableToPoints(
  table: Table,
  keep: (row: Record<string, unknown>) => boolean = () => true,
): FeatureCollection<Point> {
  const lng = table.fields.indexOf('lng');
  const lat = table.fields.indexOf('lat');
  if (lng === -1 || lat === -1) throw new Error('colonnes lng/lat absentes');
  const features: FeatureCollection<Point>['features'] = [];
  for (const row of table.rows) {
    const properties: Record<string, unknown> = {};
    table.fields.forEach((field, i) => {
      if (i !== lng && i !== lat) properties[field] = row[i];
    });
    if (!keep(properties)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row[lng] as number, row[lat] as number] },
      properties,
    });
  }
  return { type: 'FeatureCollection', features };
}
