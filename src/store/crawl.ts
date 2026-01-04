import type { Database } from "bun:sqlite";
import type { CrawlPageRow } from "./types";

export function getCrawlPage(db: Database, id: number): CrawlPageRow | null {
  const row = db
    .prepare("SELECT * FROM crawl_pages WHERE id = ?")
    .get(id) as CrawlPageRow | null;
  return row ?? null;
}

export function getPendingCrawlPages(db: Database, sourceId: number, limit: number): CrawlPageRow[] {
  return db
    .prepare(
      "SELECT * FROM crawl_pages WHERE source_id = ? AND status IN ('pending', 'failed') ORDER BY depth ASC, id ASC LIMIT ?"
    )
    .all(sourceId, limit) as CrawlPageRow[];
}

export function countCrawlPages(db: Database, sourceId: number): { total: number; pending: number; done: number; failed: number } {
  const sql =
    "SELECT " +
    "COUNT(*) as total, " +
    "SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending, " +
    "SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done, " +
    "SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed " +
    "FROM crawl_pages WHERE source_id = ?";
  const row = db
    .prepare(sql)
    .get(sourceId) as { total: number; pending: number; done: number; failed: number };
  return row;
}

export function upsertCrawlPage(db: Database, input: {
  sourceId: number;
  url: string;
  normalizedUrl: string;
  depth: number;
}): { id: number; created: boolean } {
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT id FROM crawl_pages WHERE source_id = ? AND normalized_url = ?")
    .get(input.sourceId, input.normalizedUrl) as { id: number } | null;

  if (existing) {
    return { id: existing.id, created: false };
  }

  const result = db
    .prepare(
      "INSERT INTO crawl_pages (source_id, url, normalized_url, depth, status, created_at, updated_at)\n       VALUES (?, ?, ?, ?, 'pending', ?, ?)"
    )
    .run(input.sourceId, input.url, input.normalizedUrl, input.depth, now, now);
  return { id: Number(result.lastInsertRowid), created: true };
}

export function updateCrawlPageStatus(
  db: Database,
  id: number,
  status: CrawlPageRow["status"],
  errorMessage?: string | null,
): void {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE crawl_pages SET status = ?, last_crawled_at = ?, error_message = ?, updated_at = ? WHERE id = ?"
  ).run(status, now, errorMessage ?? null, now, id);
}

export function clearCrawlPages(db: Database, sourceId: number): void {
  db.prepare("DELETE FROM crawl_pages WHERE source_id = ?").run(sourceId);
}
