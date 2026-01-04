import type { Kysely } from "kysely";

type MigrationDb = Record<string, unknown>;

export async function up(db: Kysely<MigrationDb>): Promise<void> {
  await db.schema
    .createTable("sources")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("owner", "text")
    .addColumn("repo", "text")
    .addColumn("ref", "text")
    .addColumn("docs_path", "text")
    .addColumn("ingest_mode", "text")
    .addColumn("version_label", "text")
    .addColumn("db_path", "text")
    .addColumn("created_at", "text", (col) => col.notNull())
    .addColumn("updated_at", "text", (col) => col.notNull())
    .addColumn("last_sync_at", "text")
    .addColumn("last_commit", "text")
    .addColumn("last_etag", "text")
    .addColumn("last_error", "text")
    .addColumn("root_url", "text")
    .addColumn("allowed_paths", "text")
    .addColumn("denied_paths", "text")
    .addColumn("max_depth", "integer", (col) => col.defaultTo(3))
    .addColumn("max_pages", "integer", (col) => col.defaultTo(500))
    .execute();

  await db.schema
    .createTable("source_versions")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("source_id", "integer", (col) => col.notNull())
    .addColumn("version_label", "text", (col) => col.notNull())
    .addColumn("ref", "text")
    .addColumn("commit_sha", "text")
    .addColumn("tree_hash", "text")
    .addColumn("etag", "text")
    .addColumn("synced_at", "text", (col) => col.notNull())
    .addForeignKeyConstraint(
      "fk_source_versions_source",
      ["source_id"],
      "sources",
      ["id"],
      (cb) => cb.onDelete("cascade"),
    )
    .execute();
}

export async function down(db: Kysely<MigrationDb>): Promise<void> {
  await db.schema.dropTable("source_versions").ifExists().execute();
  await db.schema.dropTable("sources").ifExists().execute();
}
