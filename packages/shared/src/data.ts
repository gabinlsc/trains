import { z } from 'zod';

/**
 * Manifeste publié avec chaque génération de données
 * (DATA_DIR/data/<dataVersion>/manifest.json). Il rend la génération
 * traçable : d'où vient chaque fichier, quand, avec quelle empreinte.
 */
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'empreinte SHA-256 attendue');

export const ManifestSourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  producer: z.string().min(1),
  license: z.string().min(1),
  url: z.url(),
  retrievedAt: z.iso.datetime(),
  sha256: Sha256Schema,
  bytes: z.number().int().nonnegative(),
  /** Nombre de fichiers agrégés (ex. tuiles d'altitude), 1 sinon. */
  files: z.number().int().positive(),
});
export type ManifestSource = z.infer<typeof ManifestSourceSchema>;

export const ManifestOutputSchema = z.object({
  file: z.string().min(1),
  sha256: Sha256Schema,
  bytes: z.number().int().nonnegative(),
  /** Nombre d'objets (lignes, entités) pour un contrôle rapide de cohérence. */
  count: z.number().int().nonnegative(),
});
export type ManifestOutput = z.infer<typeof ManifestOutputSchema>;

export const DataManifestSchema = z.object({
  dataVersion: z.string().regex(/^\d{4}\.\d{2}\.\d+$/),
  generatedAt: z.iso.datetime(),
  sources: z.array(ManifestSourceSchema),
  outputs: z.array(ManifestOutputSchema),
});
export type DataManifest = z.infer<typeof DataManifestSchema>;

/** Emprise de travail : métropole, Corse et villes frontalières desservies. */
export const DATA_BBOX = { west: -5.8, south: 41.2, east: 10.2, north: 51.6 } as const;
