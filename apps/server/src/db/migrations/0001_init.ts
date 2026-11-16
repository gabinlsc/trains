import { sql, type Kysely } from 'kysely';

// Les migrations reçoivent un Kysely<unknown> : elles décrivent l'état de la
// base à leur date, indépendamment du schéma TypeScript courant.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('app_meta')
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('value', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('app_meta').execute();
}
