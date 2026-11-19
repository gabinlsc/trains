import {
  earthworkDepth,
  gradeLimits,
  gradeLine,
  maxGrade,
  proposeStructures,
  type LngLat,
  type ProposedStructure,
} from '@trains/engine';

export interface TerrainProfile {
  step: number;
  distance: number[];
  elevation: (number | null)[];
}

/** Altitude du terrain le long d'un tracé, calculée par l'API. */
export async function fetchProfile(
  points: readonly LngLat[],
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<TerrainProfile> {
  const response = await fetchImpl('/api/elevation/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ points: points.map((p) => [p[0], p[1]]) }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`profil indisponible (HTTP ${response.status})`);
  return (await response.json()) as TerrainProfile;
}

export interface ProfileAnalysis {
  length: number;
  /** Cote de la voie à chaque échantillon. */
  track: number[];
  terrain: number[];
  structures: ProposedStructure[];
  /** Rampe maximale admise pour la vitesse (‰). */
  limit: number;
  /** Rampe maximale du terrain et de la voie, sur 1 km (‰). */
  terrainGrade: number;
  trackGrade: number;
  tunnelLength: number;
  viaductLength: number;
  minElevation: number;
  maxElevation: number;
  /** Écart moyen voie/terrain hors ouvrages (m), pour les terrassements. */
  earthworkDepth: number;
}

/**
 * Ligne rouge et ouvrages pour une vitesse de conception donnée. Les points
 * hors grille reprennent l'altitude connue précédente.
 */
export function analyseProfile(profile: TerrainProfile, speedKmh: number): ProfileAnalysis {
  const limit = gradeLimits(speedKmh).normal;
  const track = gradeLine(profile.distance, profile.elevation, limit);
  let last = profile.elevation.find((z): z is number => z !== null) ?? 0;
  const terrain = profile.elevation.map((z) => {
    if (z !== null) last = z;
    return last;
  });
  const structures = proposeStructures(profile.distance, terrain, track);
  const sum = (kind: ProposedStructure['kind']) =>
    structures.filter((s) => s.kind === kind).reduce((total, s) => total + (s.to - s.from), 0);
  const series = (values: number[]) =>
    profile.distance.map((distance, i) => ({ distance, elevation: values[i] ?? 0 }));
  const all = [...terrain, ...track];
  return {
    length: profile.distance.at(-1) ?? 0,
    track,
    terrain,
    structures,
    limit,
    terrainGrade: maxGrade(series(terrain)),
    trackGrade: maxGrade(series(track)),
    tunnelLength: sum('tunnel'),
    viaductLength: sum('viaduct'),
    minElevation: Math.min(...all),
    maxElevation: Math.max(...all),
    earthworkDepth: earthworkDepth(terrain, track, structures, profile.distance),
  };
}
