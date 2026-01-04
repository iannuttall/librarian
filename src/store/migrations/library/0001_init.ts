import type { Kysely } from "kysely";
import { sql } from "kysely";

type MigrationDb = Record<string, unknown>;

export async function up(db: Kysely<MigrationDb>): Promise<void> {
  await db.schema
    .createTable("document_blobs")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("hash", "text", (col) => col.notNull().unique())
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull())
    .execute();

  await db.schema
    .createTable("documents")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("source_id", "integer", (col) => col.notNull())
    .addColumn("path", "text", (col) => col.notNull())
    .addColumn("uri", "text", (col) => col.notNull())
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("hash", "text", (col) => col.notNull())
    .addColumn("content_type", "text", (col) => col.notNull())
    .addColumn("version_label", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull())
    .addColumn("updated_at", "text", (col) => col.notNull())
    .addColumn("active", "integer", (col) => col.notNull().defaultTo(1))
    .addUniqueConstraint("documents_unique", ["source_id", "path", "version_label"])
    .addForeignKeyConstraint("fk_documents_blob", ["hash"], "document_blobs", ["hash"], (cb) => cb.onDelete("cascade"))
    .execute();

  await db.schema
    .createTable("chunks")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("document_id", "integer", (col) => col.notNull())
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("chunk_type", "text", (col) => col.notNull())
    .addColumn("context_path", "text")
    .addColumn("title", "text")
    .addColumn("preview", "text")
    .addColumn("language", "text")
    .addColumn("symbol_name", "text")
    .addColumn("symbol_type", "text")
    .addColumn("symbol_id", "text")
    .addColumn("symbol_part_index", "integer")
    .addColumn("symbol_part_count", "integer")
    .addColumn("line_start", "integer")
    .addColumn("line_end", "integer")
    .addColumn("char_start", "integer")
    .addColumn("char_end", "integer")
    .addColumn("token_count", "integer", (col) => col.notNull())
    .addColumn("chunk_sha", "text", (col) => col.notNull())
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("doc_path", "text", (col) => col.notNull())
    .addColumn("doc_uri", "text", (col) => col.notNull())
    .addColumn("doc_title", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull())
    .addColumn("updated_at", "text", (col) => col.notNull())
    .addForeignKeyConstraint("fk_chunks_document", ["document_id"], "documents", ["id"], (cb) => cb.onDelete("cascade"))
    .execute();

  await db.schema.createIndex("idx_chunks_document").on("chunks").column("document_id").execute();
  await db.schema.createIndex("idx_chunks_sha").on("chunks").column("chunk_sha").execute();

  await db.schema
    .createTable("chunk_vectors")
    .addColumn("chunk_id", "integer", (col) => col.notNull())
    .addColumn("model", "text", (col) => col.notNull())
    .addColumn("embedded_at", "text", (col) => col.notNull())
    .addPrimaryKeyConstraint("chunk_vectors_pk", ["chunk_id", "model"])
    .addForeignKeyConstraint("fk_chunk_vectors_chunk", ["chunk_id"], "chunks", ["id"], (cb) => cb.onDelete("cascade"))
    .execute();

  await db.schema
    .createTable("crawl_pages")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("source_id", "integer", (col) => col.notNull())
    .addColumn("url", "text", (col) => col.notNull())
    .addColumn("normalized_url", "text", (col) => col.notNull())
    .addColumn("depth", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
    .addColumn("last_crawled_at", "text")
    .addColumn("error_message", "text")
    .addColumn("created_at", "text", (col) => col.notNull())
    .addColumn("updated_at", "text", (col) => col.notNull())
    .addUniqueConstraint("crawl_pages_unique", ["source_id", "normalized_url"])
    .execute();
  await db.schema
    .createIndex("idx_crawl_pages_source_status")
    .on("crawl_pages")
    .columns(["source_id", "status"])
    .execute();

  await sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content,
      title,
      path,
      context_path,
      uri,
      tokenize='porter unicode61'
    )
  `.execute(db);

  await sql`
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks
    BEGIN
      INSERT INTO chunks_fts(rowid, content, title, path, context_path, uri)
      VALUES (new.id, new.content, new.doc_title, new.doc_path, new.context_path, new.doc_uri);
    END
  `.execute(db);

  await sql`
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      DELETE FROM chunks_fts WHERE rowid = old.id;
    END
  `.execute(db);

  await sql`
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT OR REPLACE INTO chunks_fts(rowid, content, title, path, context_path, uri)
      VALUES (new.id, new.content, new.doc_title, new.doc_path, new.context_path, new.doc_uri);
    END
  `.execute(db);
}

export async function down(db: Kysely<MigrationDb>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS chunks_au`.execute(db);
  await sql`DROP TRIGGER IF EXISTS chunks_ad`.execute(db);
  await sql`DROP TRIGGER IF EXISTS chunks_ai`.execute(db);
  await sql`DROP TABLE IF EXISTS chunks_fts`.execute(db);
  await db.schema.dropTable("crawl_pages").ifExists().execute();
  await db.schema.dropTable("chunk_vectors").ifExists().execute();
  await db.schema.dropTable("chunks").ifExists().execute();
  await db.schema.dropTable("documents").ifExists().execute();
  await db.schema.dropTable("document_blobs").ifExists().execute();
}
