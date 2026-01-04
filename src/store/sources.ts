import type { Database } from "bun:sqlite";
import type { SourceRow } from "./types";

export function addGithubSource(db: Database, input: {
  name: string;
  owner: string;
  repo: string;
  ref?: string | null;
  docsPath?: string | null;
  ingestMode?: string | null;
  versionLabel?: string | null;
  dbPath?: string | null;
}): number {
  const now = new Date().toISOString();
  const result = db
    .prepare([
      "INSERT INTO sources (kind, name, owner, repo, ref, docs_path, ingest_mode, version_label, db_path, created_at, updated_at)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ].join(" "))
    .run(
      "github",
      input.name,
      input.owner,
      input.repo,
      input.ref ?? null,
      input.docsPath ?? null,
      input.ingestMode ?? null,
      input.versionLabel ?? null,
      input.dbPath ?? null,
      now,
      now,
    );
  return Number(result.lastInsertRowid);
}

export function addWebSource(db: Database, input: {
  name: string;
  rootUrl: string;
  allowedPaths?: string[];
  deniedPaths?: string[];
  maxDepth?: number;
  maxPages?: number;
  versionLabel?: string | null;
  dbPath?: string | null;
}): number {
  const now = new Date().toISOString();
  const result = db
    .prepare([
      "INSERT INTO sources (kind, name, root_url, allowed_paths, denied_paths, max_depth, max_pages, version_label, db_path, created_at, updated_at)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ].join(" "))
    .run(
      "web",
      input.name,
      input.rootUrl,
      input.allowedPaths ? JSON.stringify(input.allowedPaths) : null,
      input.deniedPaths ? JSON.stringify(input.deniedPaths) : null,
      input.maxDepth ?? 3,
      input.maxPages ?? 500,
      input.versionLabel ?? null,
      input.dbPath ?? null,
      now,
      now,
    );
  return Number(result.lastInsertRowid);
}

export function listSources(db: Database): SourceRow[] {
  return db
    .prepare([
      "SELECT id, kind, name, owner, repo, ref, docs_path, ingest_mode, version_label, db_path, last_sync_at, last_commit, last_etag, last_error,",
      "root_url, allowed_paths, denied_paths, max_depth, max_pages",
      "FROM sources ORDER BY created_at ASC",
    ].join(" "))
    .all() as SourceRow[];
}

export function getSourceById(db: Database, id: number): SourceRow | null {
  const row = db
    .prepare([
      "SELECT id, kind, name, owner, repo, ref, docs_path, ingest_mode, version_label, db_path, last_sync_at, last_commit, last_etag, last_error,",
      "root_url, allowed_paths, denied_paths, max_depth, max_pages",
      "FROM sources WHERE id = ?",
    ].join(" "))
    .get(id) as SourceRow | null;
  return row ?? null;
}

export function removeSource(db: Database, id: number): void {
  db.prepare("DELETE FROM sources WHERE id = ?").run(id);
}

export function updateSourceSync(db: Database, id: number, patch: {
  lastSyncAt?: string | null;
  lastCommit?: string | null;
  lastEtag?: string | null;
  lastError?: string | null;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE sources SET last_sync_at = ?, last_commit = ?, last_etag = ?, last_error = ?, updated_at = ? WHERE id = ?",
  ).run(
    patch.lastSyncAt ?? null,
    patch.lastCommit ?? null,
    patch.lastEtag ?? null,
    patch.lastError ?? null,
    now,
    id,
  );
}

export function updateSourceRef(db: Database, id: number, ref: string | null): void {
  const now = new Date().toISOString();
  db.prepare("UPDATE sources SET ref = ?, updated_at = ? WHERE id = ?").run(ref, now, id);
}

export function updateSourceDbPath(db: Database, id: number, dbPath: string | null): void {
  const now = new Date().toISOString();
  db.prepare("UPDATE sources SET db_path = ?, updated_at = ? WHERE id = ?").run(dbPath, now, id);
}

export function addSourceVersion(db: Database, input: {
  sourceId: number;
  versionLabel: string;
  ref?: string | null;
  commitSha?: string | null;
  treeHash?: string | null;
  etag?: string | null;
}): void {
  const now = new Date().toISOString();
  db.prepare("DELETE FROM source_versions WHERE source_id = ? AND version_label = ?").run(
    input.sourceId,
    input.versionLabel,
  );
  db.prepare([
    "INSERT INTO source_versions (source_id, version_label, ref, commit_sha, tree_hash, etag, synced_at)",
    "VALUES (?, ?, ?, ?, ?, ?, ?)",
  ].join(" ")).run(
    input.sourceId,
    input.versionLabel,
    input.ref ?? null,
    input.commitSha ?? null,
    input.treeHash ?? null,
    input.etag ?? null,
    now,
  );
}

export function listSourceVersions(db: Database, sourceId: number): Array<{
  version_label: string;
  ref: string | null;
  commit_sha: string | null;
  etag: string | null;
  synced_at: string;
}> {
  return db
    .prepare([
      "SELECT version_label, ref, commit_sha, etag, synced_at",
      "FROM source_versions",
      "WHERE source_id = ?",
      "ORDER BY synced_at DESC",
    ].join(" "))
    .all(sourceId) as Array<{
      version_label: string;
      ref: string | null;
      commit_sha: string | null;
      etag: string | null;
      synced_at: string;
    }>;
}
