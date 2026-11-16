import type { Generated } from 'kysely';

/**
 * Schéma typé de la base. Chaque table ajoutée par une migration doit être
 * déclarée ici pour que les requêtes Kysely restent vérifiées à la compilation.
 */
export interface AppMetaTable {
  key: string;
  value: string;
  updated_at: Generated<string>;
}

export interface DatabaseSchema {
  app_meta: AppMetaTable;
}
