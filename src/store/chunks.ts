import type { Database } from "bun:sqlite";
import { sha256Hex } from "../utils/hash";
import type { ChunkDraft } from "../chunk/types";
import { hasVectorsTable } from "./utils";

export function deleteChunksForDocument(db: Database, documentId: number): void {
  const ids = db
    .prepare("SELECT id FROM chunks WHERE document_id = ?")
    .all(documentId) as { id: number }[];
  const chunkIds = ids.map((row) => row.id);
  if (chunkIds.length > 0 && hasVectorsTable(db)) {
    const placeholders = chunkIds.map(() => "?").join(", ");
    db.prepare(`DELETE FROM vectors_vec WHERE chunk_id IN (${placeholders})`).run(...chunkIds);
  }
  db.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId);
}

export function insertChunks(db: Database, input: {
  documentId: number;
  docPath: string;
  docUri: string;
  docTitle: string;
  drafts: ChunkDraft[];
}): number[] {
  const now = new Date().toISOString();
  const ids: number[] = [];

  const stmt = db.prepare(
    "INSERT INTO chunks (\n" +
      "  document_id, position, chunk_type, context_path, title, preview, language,\n" +
      "  symbol_name, symbol_type, symbol_id, symbol_part_index, symbol_part_count,\n" +
      "  line_start, line_end, char_start, char_end, token_count, chunk_sha, content,\n" +
      "  doc_path, doc_uri, doc_title, created_at, updated_at\n" +
      ") VALUES (\n" +
      "  ?, ?, ?, ?, ?, ?, ?,\n" +
      "  ?, ?, ?, ?, ?,\n" +
      "  ?, ?, ?, ?, ?, ?, ?,\n" +
      "  ?, ?, ?, ?, ?\n" +
      ")",
  );

  db.transaction(() => {
    for (const [index, draft] of input.drafts.entries()) {
      const chunkSha = sha256Hex(`${input.documentId}:${index}:${draft.content}`);
      const result = stmt.run(
        input.documentId,
        index,
        draft.chunkType,
        draft.contextPath ?? null,
        draft.title ?? input.docTitle,
        draft.preview ?? null,
        draft.language ?? null,
        draft.symbolName ?? null,
        draft.symbolType ?? null,
        draft.symbolId ?? null,
        draft.symbolPartIndex ?? null,
        draft.symbolPartCount ?? null,
        draft.lineStart ?? null,
        draft.lineEnd ?? null,
        draft.charStart ?? null,
        draft.charEnd ?? null,
        draft.tokenCount,
        chunkSha,
        draft.content,
        input.docPath,
        input.docUri,
        input.docTitle,
        now,
        now,
      );
      ids.push(Number(result.lastInsertRowid));
    }
  })();

  return ids;
}

export function getChunksNeedingEmbedding(db: Database, model: string): number[] {
  const rows = db
    .prepare(
      "SELECT c.id as id FROM chunks c\n" +
        "JOIN documents d ON d.id = c.document_id\n" +
        "LEFT JOIN chunk_vectors v ON v.chunk_id = c.id AND v.model = ?\n" +
        "WHERE v.chunk_id IS NULL AND d.active = 1",
    )
    .all(model) as { id: number }[];
  return rows.map((row) => row.id);
}

export function loadChunkForEmbedding(db: Database, id: number): {
  id: number;
  content: string;
  title: string;
  contextPath: string | null;
  docTitle: string;
  docUri: string;
  docPath: string;
} | null {
  const row = db
    .prepare(
      "SELECT id, content, title, context_path as contextPath, doc_title as docTitle, doc_uri as docUri, doc_path as docPath\n" +
        "FROM chunks WHERE id = ?",
    )
    .get(id) as {
      id: number;
      content: string;
      title: string;
      contextPath: string | null;
      docTitle: string;
      docUri: string;
      docPath: string;
    } | null;
  return row ?? null;
}

export function updateChunkTokenCount(db: Database, id: number, tokenCount: number): void {
  const now = new Date().toISOString();
  db.prepare("UPDATE chunks SET token_count = ?, updated_at = ? WHERE id = ?").run(tokenCount, now, id);
}
