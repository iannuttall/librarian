import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import { runIndexMigrations, runLibraryMigrations } from "./migrate";
import { buildLibraryDbPath } from "./library-db";
import type { SourceRow } from "./types";

export async function maybeMigrateLegacySingleDb(indexPath: string): Promise<void> {
  if (!existsSync(indexPath)) return;
  let probe: Database | null = null;
  try {
    probe = new Database(indexPath);
    const legacy = tableExists(probe, "documents") && tableExists(probe, "sources");
    probe.close();
    probe = null;
    if (!legacy) return;
    await migrateLegacyDb(indexPath);
  } catch (error) {
    if (probe) {
      try {
        probe.close();
      } catch {
        // ignore
      }
    }
    if (!isRecoverableSqliteError(error)) throw error;
    try {
      unlinkSync(indexPath);
    } catch {
      // ignore
    }
  }
}

async function migrateLegacyDb(indexPath: string): Promise<void> {
  const legacyPath = `${indexPath}.legacy`;
  if (existsSync(legacyPath)) {
    unlinkSync(legacyPath);
  }
  renameSync(indexPath, legacyPath);

  const indexDb = openDatabase(indexPath);
  const legacyDb = openDatabase(legacyPath);

  try {
    await runIndexMigrations(indexDb);
    await migrateSources(indexDb, legacyDb);
    await migrateSourceVersions(indexDb, legacyDb);
    await migrateLibraryData(indexDb, legacyDb);
    legacyDb.close();
    indexDb.close();
    unlinkSync(legacyPath);
  } catch (error) {
    legacyDb.close();
    indexDb.close();
    if (existsSync(indexPath)) unlinkSync(indexPath);
    renameSync(legacyPath, indexPath);
    throw error;
  }
}

function openDatabase(path: string): Database {
  const db = new Database(path);
  sqliteVec.load(db);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function migrateSources(indexDb: Database, legacyDb: Database): void {
  const rows = legacyDb.prepare([
    "SELECT id, kind, name, owner, repo, ref, docs_path, ingest_mode, version_label,",
    "created_at, updated_at, last_sync_at, last_commit, last_etag, last_error,",
    "root_url, allowed_paths, denied_paths, max_depth, max_pages",
    "FROM sources ORDER BY id ASC",
  ].join(" ")).all() as Array<Omit<SourceRow, "db_path">>;

  const stmt = indexDb.prepare([
    "INSERT INTO sources (",
    "id, kind, name, owner, repo, ref, docs_path, ingest_mode, version_label, db_path,",
    "created_at, updated_at, last_sync_at, last_commit, last_etag, last_error,",
    "root_url, allowed_paths, denied_paths, max_depth, max_pages",
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ].join(" "));

  for (const row of rows) {
    const dbPath = buildLibraryDbPath({
      ...row,
      db_path: null,
    });
    stmt.run(
      row.id,
      row.kind,
      row.name,
      row.owner,
      row.repo,
      row.ref,
      row.docs_path,
      row.ingest_mode,
      row.version_label,
      dbPath,
      row.created_at,
      row.updated_at,
      row.last_sync_at,
      row.last_commit,
      row.last_etag,
      row.last_error,
      row.root_url,
      row.allowed_paths,
      row.denied_paths,
      row.max_depth,
      row.max_pages,
    );
  }
}

function migrateSourceVersions(indexDb: Database, legacyDb: Database): void {
  if (!tableExists(legacyDb, "source_versions")) return;
  const hasRef = columnExists(legacyDb, "source_versions", "ref");
  const hasEtag = columnExists(legacyDb, "source_versions", "etag");
  const rows = legacyDb.prepare(
    `SELECT source_id, version_label,
      ${hasRef ? "ref" : "NULL"} as ref,
      commit_sha, tree_hash,
      ${hasEtag ? "etag" : "NULL"} as etag,
      synced_at
     FROM source_versions`,
  ).all() as Array<{
    source_id: number;
    version_label: string;
    ref: string | null;
    commit_sha: string | null;
    tree_hash: string | null;
    etag: string | null;
    synced_at: string;
  }>;

  const stmt = indexDb.prepare(
    [
      "INSERT INTO source_versions (source_id, version_label, ref, commit_sha, tree_hash, etag, synced_at)",
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
    ].join(" "),
  );
  for (const row of rows) {
    stmt.run(row.source_id, row.version_label, row.ref, row.commit_sha, row.tree_hash, row.etag, row.synced_at);
  }
}

async function migrateLibraryData(indexDb: Database, legacyDb: Database): Promise<void> {
  const sources = indexDb.prepare([
    "SELECT id, kind, name, owner, repo, ref, docs_path, ingest_mode, version_label, db_path,",
    "created_at, updated_at, last_sync_at, last_commit, last_etag, last_error,",
    "root_url, allowed_paths, denied_paths, max_depth, max_pages",
    "FROM sources ORDER BY id ASC",
  ].join(" ")).all() as SourceRow[];

  const hasVectors = tableExists(legacyDb, "vectors_vec");
  const vecDims = hasVectors ? getVecDimensions(legacyDb) : null;

  for (const source of sources) {
    const dbPath = source.db_path || buildLibraryDbPath(source);
    const libraryDb = openDatabase(dbPath);
    await runLibraryMigrations(libraryDb);
    if (vecDims && hasVectors) {
      ensureVecTable(libraryDb, vecDims);
    }
    copySourceData(legacyDb, libraryDb, source.id, hasVectors);
    libraryDb.close();
  }
}

function copySourceData(legacyDb: Database, libraryDb: Database, sourceId: number, hasVectors: boolean): void {
  libraryDb.exec("BEGIN");
  try {
    const blobRows = legacyDb.prepare([
      "SELECT DISTINCT b.hash, b.content, b.created_at",
      "FROM document_blobs b",
      "JOIN documents d ON d.hash = b.hash",
      "WHERE d.source_id = ?",
    ].join(" ")).all(sourceId) as Array<{ hash: string; content: string; created_at: string }>;
    const blobStmt = libraryDb.prepare(
      "INSERT OR IGNORE INTO document_blobs (hash, content, created_at) VALUES (?, ?, ?)",
    );
    for (const row of blobRows) {
      blobStmt.run(row.hash, row.content, row.created_at);
    }

    const docRows = legacyDb.prepare([
      "SELECT id, source_id, path, uri, title, hash, content_type, version_label, created_at, updated_at, active",
      "FROM documents WHERE source_id = ?",
    ].join(" ")).all(sourceId) as Array<{
      id: number;
      source_id: number;
      path: string;
      uri: string;
      title: string;
      hash: string;
      content_type: string;
      version_label: string;
      created_at: string;
      updated_at: string;
      active: number;
    }>;
    const docStmt = libraryDb.prepare([
      "INSERT INTO documents (",
      "id, source_id, path, uri, title, hash, content_type, version_label, created_at, updated_at, active",
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ].join(" "));
    for (const row of docRows) {
      docStmt.run(
        row.id,
        row.source_id,
        row.path,
        row.uri,
        row.title,
        row.hash,
        row.content_type,
        row.version_label,
        row.created_at,
        row.updated_at,
        row.active,
      );
    }

    const chunkRows = legacyDb.prepare([
      "SELECT c.*",
      "FROM chunks c",
      "JOIN documents d ON d.id = c.document_id",
      "WHERE d.source_id = ?",
    ].join(" ")).all(sourceId) as Array<{
      id: number;
      document_id: number;
      position: number;
      chunk_type: string;
      context_path: string | null;
      title: string | null;
      preview: string | null;
      language: string | null;
      symbol_name: string | null;
      symbol_type: string | null;
      symbol_id: string | null;
      symbol_part_index: number | null;
      symbol_part_count: number | null;
      line_start: number | null;
      line_end: number | null;
      char_start: number | null;
      char_end: number | null;
      token_count: number;
      chunk_sha: string;
      content: string;
      doc_path: string;
      doc_uri: string;
      doc_title: string;
      created_at: string;
      updated_at: string;
    }>;
    const chunkStmt = libraryDb.prepare([
      "INSERT INTO chunks (",
      "id, document_id, position, chunk_type, context_path, title, preview, language,",
      "symbol_name, symbol_type, symbol_id, symbol_part_index, symbol_part_count,",
      "line_start, line_end, char_start, char_end, token_count, chunk_sha, content,",
      "doc_path, doc_uri, doc_title, created_at, updated_at",
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ].join(" "));
    for (const row of chunkRows) {
      chunkStmt.run(
        row.id,
        row.document_id,
        row.position,
        row.chunk_type,
        row.context_path,
        row.title,
        row.preview,
        row.language,
        row.symbol_name,
        row.symbol_type,
        row.symbol_id,
        row.symbol_part_index,
        row.symbol_part_count,
        row.line_start,
        row.line_end,
        row.char_start,
        row.char_end,
        row.token_count,
        row.chunk_sha,
        row.content,
        row.doc_path,
        row.doc_uri,
        row.doc_title,
        row.created_at,
        row.updated_at,
      );
    }

    if (tableExists(legacyDb, "chunk_vectors")) {
      const vectorRows = legacyDb.prepare([
        "SELECT v.chunk_id, v.model, v.embedded_at",
        "FROM chunk_vectors v",
        "JOIN chunks c ON c.id = v.chunk_id",
        "JOIN documents d ON d.id = c.document_id",
        "WHERE d.source_id = ?",
      ].join(" ")).all(sourceId) as Array<{ chunk_id: number; model: string; embedded_at: string }>;
      const vectorStmt = libraryDb.prepare(
        "INSERT INTO chunk_vectors (chunk_id, model, embedded_at) VALUES (?, ?, ?)",
      );
      for (const row of vectorRows) {
        vectorStmt.run(row.chunk_id, row.model, row.embedded_at);
      }
    }

    if (hasVectors && tableExists(legacyDb, "vectors_vec")) {
      const vecRows = legacyDb.prepare([
        "SELECT v.chunk_id as chunk_id, v.embedding as embedding",
        "FROM vectors_vec v",
        "JOIN chunks c ON c.id = v.chunk_id",
        "JOIN documents d ON d.id = c.document_id",
        "WHERE d.source_id = ?",
      ].join(" ")).all(sourceId) as Array<{ chunk_id: number; embedding: Float32Array }>;
      const vecStmt = libraryDb.prepare(
        "INSERT INTO vectors_vec (chunk_id, embedding) VALUES (?, ?)",
      );
      for (const row of vecRows) {
        vecStmt.run(row.chunk_id, row.embedding);
      }
    }

    if (tableExists(legacyDb, "crawl_pages")) {
      const crawlRows = legacyDb.prepare([
        "SELECT id, source_id, url, normalized_url, depth, status, last_crawled_at, error_message, created_at, updated_at",
        "FROM crawl_pages WHERE source_id = ?",
      ].join(" ")).all(sourceId) as Array<{
        id: number;
        source_id: number;
        url: string;
        normalized_url: string;
        depth: number;
        status: string;
        last_crawled_at: string | null;
        error_message: string | null;
        created_at: string;
        updated_at: string;
      }>;
      const crawlStmt = libraryDb.prepare([
        "INSERT INTO crawl_pages (",
        "id, source_id, url, normalized_url, depth, status, last_crawled_at, error_message, created_at, updated_at",
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "));
      for (const row of crawlRows) {
        crawlStmt.run(
          row.id,
          row.source_id,
          row.url,
          row.normalized_url,
          row.depth,
          row.status,
          row.last_crawled_at,
          row.error_message,
          row.created_at,
          row.updated_at,
        );
      }
    }

    libraryDb.exec("COMMIT");
  } catch (error) {
    libraryDb.exec("ROLLBACK");
    throw error;
  }
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { name: string } | null;
  return Boolean(row?.name);
}

function columnExists(db: Database, table: string, name: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((col) => col.name === name);
}

function getVecDimensions(db: Database): number | null {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='vectors_vec'")
    .get() as { sql: string } | null;
  if (!row?.sql) return null;
  const match = row.sql.match(/float\\[(\\d+)\\]/);
  if (!match?.[1]) return null;
  return Number.parseInt(match[1], 10);
}

function ensureVecTable(db: Database, dimensions: number): void {
  const tableInfo = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='vectors_vec'")
    .get() as { sql: string } | null;
  if (tableInfo) {
    const match = tableInfo.sql.match(/float\\[(\\d+)\\]/);
    const hasChunkId = tableInfo.sql.includes("chunk_id");
    const hasCosine = tableInfo.sql.includes("distance_metric=cosine");
    const existingDims = match?.[1] ? Number.parseInt(match[1], 10) : null;
    if (existingDims === dimensions && hasChunkId && hasCosine) return;
    db.exec("DROP TABLE IF EXISTS vectors_vec");
  }
  db.exec(
    `CREATE VIRTUAL TABLE vectors_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${dimensions}] distance_metric=cosine)`,
  );
}

function isRecoverableSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes("sqlite_ioerr_short_read") || lower.includes("disk i/o error");
}
