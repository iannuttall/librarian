import type { Database } from "bun:sqlite";

export function searchFTS(
  db: Database,
  query: string,
  limit: number,
  versionLabel?: string | null,
): Array<{
  chunkId: number;
  docId: number;
  score: number;
  title: string;
  path: string;
  uri: string;
  contextPath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  tokenCount: number | null;
  preview: string | null;
  content: string;
}> {
  const clauses = ["chunks_fts MATCH ?", "d.active = 1"];
  if (versionLabel) {
    clauses.push("d.version_label = ?");
  }

  const sql = `SELECT f.rowid as chunkId, bm25(chunks_fts, 10.0, 5.0, 2.0, 1.0, 1.0) as score,
      c.document_id as docId, c.doc_title as title, c.doc_path as path, c.doc_uri as uri,
      c.context_path as contextPath, c.line_start as lineStart, c.line_end as lineEnd,
      c.token_count as tokenCount, c.preview as preview, c.content as content
    FROM chunks_fts f
    JOIN chunks c ON c.id = f.rowid
    JOIN documents d ON d.id = c.document_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY score LIMIT ?`;

  const run = (ftsQuery: string) => {
    const params: Array<string | number> = [ftsQuery];
    if (versionLabel) {
      params.push(versionLabel);
    }
    params.push(limit);
    return db.prepare(sql).all(...params) as Array<{
      chunkId: number;
      docId: number;
      score: number;
      title: string;
      path: string;
      uri: string;
      contextPath: string | null;
      lineStart: number | null;
      lineEnd: number | null;
      tokenCount: number | null;
      preview: string | null;
      content: string;
    }>;
  };

  let results: Array<{
    chunkId: number;
    docId: number;
    score: number;
    title: string;
    path: string;
    uri: string;
    contextPath: string | null;
    lineStart: number | null;
    lineEnd: number | null;
    tokenCount: number | null;
    preview: string | null;
    content: string;
  }>;

  try {
    results = run(query);
  } catch (error) {
    if (!isFtsSyntaxError(error)) throw error;
    const fallback = normalizeFtsQuery(query);
    if (!fallback || fallback === query) throw error;
    results = run(fallback);
  }

  return results.map((row) => ({
    ...row,
    score: 1 / (1 + Math.max(0, Math.abs(row.score))),
  }));
}

function normalizeFtsQuery(input: string): string {
  const trimmed = input.trim();
  const cleaned = trimmed
    .replace(/["'`]+/g, " ")
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || trimmed;
}

function isFtsSyntaxError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes("fts5") || lower.includes("syntax error") || lower.includes("no such column");
}

export function searchVec(
  db: Database,
  embedding: Float32Array,
  limit: number,
  versionLabel?: string | null,
): Array<{
  chunkId: number;
  docId: number;
  distance: number;
  title: string;
  path: string;
  uri: string;
  contextPath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  tokenCount: number | null;
  preview: string | null;
  content: string;
}> {
  const clauses = ["v.embedding MATCH ?", "k = ?", "d.active = 1"];
  const params: Array<Float32Array | number | string> = [embedding, limit];
  if (versionLabel) {
    clauses.push("d.version_label = ?");
    params.push(versionLabel);
  }

  const sql = `SELECT v.chunk_id as chunkId, v.distance as distance,
      c.document_id as docId, c.doc_title as title, c.doc_path as path, c.doc_uri as uri,
      c.context_path as contextPath, c.line_start as lineStart, c.line_end as lineEnd,
      c.token_count as tokenCount, c.preview as preview, c.content as content
    FROM vectors_vec v
    JOIN chunks c ON c.id = v.chunk_id
    JOIN documents d ON d.id = c.document_id
    WHERE ${clauses.join(" AND ")}`;

  const rows = db
    .prepare(sql)
    .all(...params) as Array<{
      chunkId: number;
      docId: number;
      distance: number;
      title: string;
      path: string;
      uri: string;
      contextPath: string | null;
      lineStart: number | null;
      lineEnd: number | null;
      tokenCount: number | null;
      preview: string | null;
      content: string;
    }>;

  return rows;
}
