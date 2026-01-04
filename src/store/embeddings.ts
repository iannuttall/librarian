import type { Database } from "bun:sqlite";

export function markChunkEmbedded(db: Database, chunkId: number, model: string): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR REPLACE INTO chunk_vectors (chunk_id, model, embedded_at) VALUES (?, ?, ?)"
  ).run(chunkId, model, now);
}

export function insertEmbedding(db: Database, chunkId: number, embedding: Float32Array, model: string): void {
  db.prepare("INSERT OR REPLACE INTO vectors_vec (chunk_id, embedding) VALUES (?, ?)").run(chunkId, embedding);
  markChunkEmbedded(db, chunkId, model);
}

export function clearAllEmbeddings(db: Database): void {
  db.exec("DELETE FROM chunk_vectors");
  db.exec("DROP TABLE IF EXISTS vectors_vec");
}
