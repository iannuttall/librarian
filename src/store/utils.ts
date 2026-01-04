import type { Database } from "bun:sqlite";

export function hasVectorsTable(db: Database): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='vectors_vec'`)
    .get() as { name: string } | null;
  return Boolean(row?.name);
}
