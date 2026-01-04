import type { Database } from "bun:sqlite";
import { hasVectorsTable } from "./utils";

export function cleanupInactive(db: Database): {
  documents: number;
  chunks: number;
  vectors: number;
  blobs: number;
} {
  const inactiveDocs = db
    .prepare("SELECT id FROM documents WHERE active = 0")
    .all() as { id: number }[];
  const docIds = inactiveDocs.map((row) => row.id);
  if (docIds.length === 0) {
    return { documents: 0, chunks: 0, vectors: 0, blobs: 0 };
  }

  const docPlaceholders = docIds.map(() => "?").join(", ");
  const chunkIds = db
    .prepare(`SELECT id FROM chunks WHERE document_id IN (${docPlaceholders})`)
    .all(...docIds) as { id: number }[];
  const chunkIdList = chunkIds.map((row) => row.id);

  let vectors = 0;
  if (chunkIdList.length > 0 && hasVectorsTable(db)) {
    const chunkPlaceholders = chunkIdList.map(() => "?").join(", ");
    const result = db
      .prepare(`DELETE FROM vectors_vec WHERE chunk_id IN (${chunkPlaceholders})`)
      .run(...chunkIdList);
    vectors = result.changes;
  }

  const chunkResult = db
    .prepare(`DELETE FROM chunks WHERE document_id IN (${docPlaceholders})`)
    .run(...docIds);
  const docResult = db
    .prepare(`DELETE FROM documents WHERE id IN (${docPlaceholders})`)
    .run(...docIds);

  const blobResult = db
    .prepare("DELETE FROM document_blobs WHERE hash NOT IN (SELECT hash FROM documents)")
    .run();

  return {
    documents: docResult.changes,
    chunks: chunkResult.changes,
    vectors,
    blobs: blobResult.changes,
  };
}
