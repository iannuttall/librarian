import { describe, expect, test, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { createStore, createLibraryStore, type Store } from "../src/store/db";
import { addWebSource, ensureLibraryDbPath, getSourceById, countCrawlPages } from "../src/store";
import { ingestWebSource } from "../src/ingest/web/ingest";

const tempDir = join(os.tmpdir(), `librarian-web-ingest-${Date.now()}`);
const dbPath = join(tempDir, "test.sqlite");

describe("web ingest", () => {
  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("ingests hono.dev/docs with limited pages", async () => {
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });

    const store = await createStore(dbPath);
    let libraryStore: Store | null = null;
    try {
      const sourceId = addWebSource(store.db, {
        name: "hono-test",
        rootUrl: "https://hono.dev/docs",
        maxDepth: 2,
        maxPages: 25,
      });

      const source = getSourceById(store.db, sourceId);
      if (!source) throw new Error("source not found");

      expect(source.kind).toBe("web");
      expect(source.root_url).toBe("https://hono.dev/docs");

      const libraryPath = ensureLibraryDbPath(store.db, source);
      libraryStore = await createLibraryStore(libraryPath);
      let lastProgress = "";
      const result = await ingestWebSource(libraryStore.db, source, {
        concurrency: 3,
        headlessEnabled: false, // Skip headless for this test
        onProgress: (progress) => {
          lastProgress = `${progress.phase}: ${progress.current}/${progress.total}`;
        },
      });

      console.log(`Last progress: ${lastProgress}`);
      console.log(`Processed: ${result.processed}, Updated: ${result.updated}, Skipped: ${result.skipped}, Failed: ${result.failed}`);

      expect(result.processed).toBeGreaterThan(0);
      expect(result.failed).toBe(0);

      // Check documents were created
      const docs = libraryStore.db.prepare(
        `SELECT d.path, d.title, d.uri
         FROM documents d
         WHERE d.source_id = ? AND d.active = 1`
      ).all(sourceId) as { path: string; title: string; uri: string }[];

      console.log(`Documents created: ${docs.length}`);
      expect(docs.length).toBeGreaterThan(0);

      // Check chunks were created
      const chunks = libraryStore.db.prepare(
        `SELECT COUNT(*) as count FROM chunks c
         JOIN documents d ON d.id = c.document_id
         WHERE d.source_id = ?`
      ).get(sourceId) as { count: number };

      console.log(`Chunks created: ${chunks.count}`);
      expect(chunks.count).toBeGreaterThan(0);

      // Check crawl pages status
      const pageStats = countCrawlPages(libraryStore.db, sourceId);
      console.log(`Crawl pages: total=${pageStats.total}, done=${pageStats.done}, pending=${pageStats.pending}, failed=${pageStats.failed}`);
      expect(pageStats.done).toBeGreaterThan(0);
      expect(pageStats.failed).toBe(0);

    } finally {
      if (libraryStore) libraryStore.close();
      store.close();
    }
  }, 120000);

  test("can resume interrupted crawl", async () => {
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });

    const store = await createStore(dbPath);
    let libraryStore: Store | null = null;
    try {
      const sourceId = addWebSource(store.db, {
        name: "hono-resume-test",
        rootUrl: "https://hono.dev/docs/guides",
        maxDepth: 1,
        maxPages: 10,
      });

      const source = getSourceById(store.db, sourceId);
      if (!source) throw new Error("source not found");
      const libraryPath = ensureLibraryDbPath(store.db, source);
      libraryStore = await createLibraryStore(libraryPath);

      // First run - partial
      const result1 = await ingestWebSource(libraryStore.db, source, {
        concurrency: 2,
        headlessEnabled: false,
      });

      console.log(`First run: processed=${result1.processed}`);
      const stats1 = countCrawlPages(libraryStore.db, sourceId);
      console.log(`After first run: done=${stats1.done}, pending=${stats1.pending}`);

      // Clear some done pages to simulate interruption (using subquery for SQLite)
      libraryStore.db.prepare(
        `UPDATE crawl_pages SET status = 'pending'
         WHERE id IN (SELECT id FROM crawl_pages WHERE source_id = ? AND status = 'done' LIMIT 3)`
      ).run(sourceId);

      const stats2 = countCrawlPages(libraryStore.db, sourceId);
      console.log(`After reset: done=${stats2.done}, pending=${stats2.pending}`);

      // Second run - should resume
      const result2 = await ingestWebSource(libraryStore.db, source, {
        concurrency: 2,
        headlessEnabled: false,
      });

      console.log(`Second run: processed=${result2.processed}`);
      expect(result2.processed).toBeGreaterThan(0);

    } finally {
      if (libraryStore) libraryStore.close();
      store.close();
    }
  }, 120000);

  test("respects force flag to re-crawl", async () => {
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });

    const store = await createStore(dbPath);
    let libraryStore: Store | null = null;
    try {
      const sourceId = addWebSource(store.db, {
        name: "hono-force-test",
        rootUrl: "https://hono.dev/docs/getting-started",
        maxDepth: 1,
        maxPages: 5,
      });

      const source = getSourceById(store.db, sourceId);
      if (!source) throw new Error("source not found");
      const libraryPath = ensureLibraryDbPath(store.db, source);
      libraryStore = await createLibraryStore(libraryPath);

      // First run
      await ingestWebSource(libraryStore.db, source, {
        concurrency: 2,
        headlessEnabled: false,
      });

      const stats1 = countCrawlPages(libraryStore.db, sourceId);
      console.log(`Before force: done=${stats1.done}`);

      // Second run with force
      await ingestWebSource(libraryStore.db, source, {
        force: true,
        concurrency: 2,
        headlessEnabled: false,
      });

      const stats2 = countCrawlPages(libraryStore.db, sourceId);
      console.log(`After force: done=${stats2.done}`);

      // Force should have reset and re-crawled
      expect(stats2.done).toBeGreaterThan(0);

    } finally {
      if (libraryStore) libraryStore.close();
      store.close();
    }
  }, 120000);
});
