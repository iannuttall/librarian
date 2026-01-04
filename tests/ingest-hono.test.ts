import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { createStore, createLibraryStore, type Store } from "../src/store/db";
import { addGithubSource, ensureLibraryDbPath, getSourceById } from "../src/store";
import { ingestGithubSource } from "../src/ingest/github/ingest";
import { containsCodeSnippet } from "./support/code-snippets";

describe("github ingest", () => {
  test("hono website docs path", async () => {
    const tempDir = join(os.tmpdir(), `librarian-hono-test-${Date.now()}`);
    const dbPath = join(tempDir, "test.sqlite");
    const oldConfigDir = process.env.LIBRARIAN_CONFIG_DIR;

    process.env.LIBRARIAN_CONFIG_DIR = tempDir;
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });

    const store = await createStore(dbPath);
    let libraryStore: Store | null = null;
    try {
      const sourceId = addGithubSource(store.db, {
        name: "honojs/website",
        owner: "honojs",
        repo: "website",
        ref: null,
        docsPath: "docs",
      });

      const source = getSourceById(store.db, sourceId);
      if (!source) throw new Error("source not found");

      const libraryPath = ensureLibraryDbPath(store.db, source);
      libraryStore = await createLibraryStore(libraryPath);
      const result = await ingestGithubSource(libraryStore.db, source);
      expect(result.processed).toBeGreaterThan(0);

      const rows = libraryStore.db.prepare(
        `SELECT d.path as path, b.content as content
         FROM documents d
         JOIN document_blobs b ON b.hash = d.hash
         WHERE d.active = 1`,
      ).all() as { path: string; content: string }[];

      const total = rows.length;
      const withCode = rows.filter((row) => containsCodeSnippet(row.content)).length;
      console.log(`ingested docs: ${total}`);
      console.log(`docs with code: ${withCode}`);
      console.log(`db path: ${dbPath}`);

      expect(total).toBeGreaterThan(0);
      expect(withCode).toBe(total);
      for (const row of rows) {
        expect(row.path.startsWith("docs/") || row.path === "docs").toBe(true);
      }
    } finally {
      if (libraryStore) libraryStore.close();
      store.close();
      process.env.LIBRARIAN_CONFIG_DIR = oldConfigDir;
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 120000);
});
