import type { Database } from "bun:sqlite";

export function upsertDocument(db: Database, input: {
  sourceId: number;
  path: string;
  uri: string;
  title: string;
  hash: string;
  contentType: string;
  versionLabel: string;
  content: string;
}): { id: number; changed: boolean } {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO document_blobs (hash, content, created_at) VALUES (?, ?, ?)"
  ).run(input.hash, input.content, now);

  const existing = db
    .prepare(
      "SELECT id, hash FROM documents WHERE source_id = ? AND path = ? AND version_label = ? LIMIT 1",
    )
    .get(input.sourceId, input.path, input.versionLabel) as { id: number; hash: string } | null;

  if (!existing) {
    const insertSql =
      "INSERT INTO documents (source_id, path, uri, title, hash, content_type, version_label, created_at, updated_at, active) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)";
    const result = db
      .prepare(insertSql)
      .run(
        input.sourceId,
        input.path,
        input.uri,
        input.title,
        input.hash,
        input.contentType,
        input.versionLabel,
        now,
        now,
      );
    return { id: Number(result.lastInsertRowid), changed: true };
  }

  if (existing.hash === input.hash) {
    db.prepare(
      "UPDATE documents SET title = ?, uri = ?, updated_at = ?, active = 1 WHERE id = ?",
    ).run(input.title, input.uri, now, existing.id);
    return { id: existing.id, changed: false };
  }

  db.prepare(
    "UPDATE documents SET title = ?, uri = ?, hash = ?, content_type = ?, updated_at = ?, active = 1 WHERE id = ?",
  ).run(input.title, input.uri, input.hash, input.contentType, now, existing.id);
  return { id: existing.id, changed: true };
}

export function deactivateMissingDocuments(db: Database, input: {
  sourceId: number;
  versionLabel: string;
  keepPaths: string[];
}): number {
  if (input.keepPaths.length === 0) {
    const result = db
      .prepare(
        "UPDATE documents SET active = 0 WHERE source_id = ? AND version_label = ?",
      )
      .run(input.sourceId, input.versionLabel);
    return result.changes;
  }

  const placeholders = input.keepPaths.map(() => "?").join(", ");
  const sql = `UPDATE documents SET active = 0 WHERE source_id = ? AND version_label = ? AND path NOT IN (${placeholders})`;
  const result = db.prepare(sql).run(input.sourceId, input.versionLabel, ...input.keepPaths);
  return result.changes;
}

export function getDocumentByPathOrUri(db: Database, value: string): {
  id: number;
  title: string;
  path: string;
  uri: string;
  content: string;
} | null {
  const row = db
    .prepare([
      "SELECT d.id as id, d.title as title, d.path as path, d.uri as uri, b.content as content",
      "FROM documents d",
      "JOIN document_blobs b ON b.hash = d.hash",
      "WHERE (d.uri = ? OR d.path = ?) AND d.active = 1",
      "LIMIT 1",
    ].join(" "))
    .get(value, value) as {
      id: number;
      title: string;
      path: string;
      uri: string;
      content: string;
    } | null;
  return row ?? null;
}

export function getDocumentById(db: Database, id: number): {
  id: number;
  title: string;
  path: string;
  uri: string;
  content: string;
} | null {
  const row = db
    .prepare([
      "SELECT d.id as id, d.title as title, d.path as path, d.uri as uri, b.content as content",
      "FROM documents d",
      "JOIN document_blobs b ON b.hash = d.hash",
      "WHERE d.id = ? AND d.active = 1",
      "LIMIT 1",
    ].join(" "))
    .get(id) as {
      id: number;
      title: string;
      path: string;
      uri: string;
      content: string;
    } | null;
  return row ?? null;
}
