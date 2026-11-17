import { z } from 'zod';
import { NetworkSchema, type Network } from './network/model.ts';

/**
 * Fichier de sauvegarde d'une partie, exporté en JSON et conservé dans le
 * navigateur. Le numéro de version suit la forme du fichier : toute
 * évolution incompatible ajoute une migration, et les fichiers anciens
 * restent lisibles indéfiniment.
 */
export const SAVE_FORMAT = 'rails-de-france/sauvegarde';
export const SAVE_VERSION = 1;

export const SaveFileSchema = z.object({
  format: z.literal(SAVE_FORMAT),
  version: z.literal(SAVE_VERSION),
  name: z.string().trim().min(1).max(120),
  savedAt: z.iso.datetime(),
  network: NetworkSchema,
});
export type SaveFile = z.infer<typeof SaveFileSchema>;

/** Migration d'une version à la suivante, sur le JSON brut. */
export type SaveMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations indexées par version de départ : `MIGRATIONS[1]` mènera de la
 * version 1 à la version 2. Aucune pour l'instant.
 */
export const SAVE_MIGRATIONS: Readonly<Record<number, SaveMigration>> = {};

export type SaveErrorCode = 'json' | 'format' | 'future' | 'invalid';

export class SaveError extends Error {
  readonly code: SaveErrorCode;

  constructor(code: SaveErrorCode, message: string) {
    super(message);
    this.name = 'SaveError';
    this.code = code;
  }
}

export function createSave(name: string, network: Network, now = new Date()): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    name: name.trim().slice(0, 120) || 'Sans titre',
    savedAt: now.toISOString(),
    network,
  };
}

export function serializeSave(save: SaveFile): string {
  return `${JSON.stringify(save, null, 2)}\n`;
}

/**
 * Lit une sauvegarde : JSON, format reconnu, migrations successives jusqu'à
 * la version courante, puis validation complète du réseau.
 */
export function parseSave(
  text: string,
  migrations: Readonly<Record<number, SaveMigration>> = SAVE_MIGRATIONS,
  current = SAVE_VERSION,
): SaveFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError('json', 'fichier illisible : JSON invalide');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SaveError('format', 'ce fichier n’est pas une sauvegarde');
  }
  let data = raw as Record<string, unknown>;
  if (data.format !== SAVE_FORMAT || !Number.isInteger(data.version)) {
    throw new SaveError('format', 'ce fichier n’est pas une sauvegarde');
  }
  let version = data.version as number;
  if (version > current) {
    throw new SaveError('future', 'sauvegarde créée par une version plus récente du jeu');
  }
  while (version < current) {
    const migrate = migrations[version];
    if (!migrate)
      throw new SaveError('invalid', `migration manquante depuis la version ${version}`);
    data = { ...migrate(data), version: version + 1 };
    version += 1;
  }
  const parsed = SaveFileSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') ?? '';
    throw new SaveError('invalid', `sauvegarde invalide${where ? ` (${where})` : ''}`);
  }
  return parsed.data;
}
