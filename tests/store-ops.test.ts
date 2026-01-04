import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { createStore, createLibraryStore, type Store } from "../src/store/db";
import {
  addGithubSource,
  ensureLibraryDbPath,
  getSourceById,
  upsertDocument,
  insertChunks,
  getChunksNeedingEmbedding,
  insertEmbedding,
  clearAllEmbeddings,
  cleanupInactive,
  searchFTS,
  searchVec,
  deactivateMissingDocuments,
} from "../src/store";

describe("store ops", () => {
  test("inserts docs, chunks, and searches", async () => {
    const tempDir = join(os.tmpdir(), `librarian-store-test-${Date.now()}`);
    const dbPath = join(tempDir, "store.sqlite");
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });

    const store = await createStore(dbPath);
    let libraryStore: Store | null = null;
    try {
      const sourceId = addGithubSource(store.db, {
        name: "demo/repo",
        owner: "demo",
        repo: "repo",
        ref: "main",
        docsPath: null,
        ingestMode: "docs",
        versionLabel: "1.x",
      });
      const source = getSourceById(store.db, sourceId);
      if (!source) {
        throw new Error("Expected source");
      }
      const libraryPath = ensureLibraryDbPath(store.db, source);
      libraryStore = await createLibraryStore(libraryPath);

      const doc = upsertDocument(libraryStore.db, {
        sourceId,
        path: "docs/intro.md",
        uri: "gh://demo/repo@main/docs/intro.md",
        title: "Intro",
        hash: "hash-1",
        contentType: "text/markdown",
        versionLabel: "1.x",
        content: "Hello world\n\n```ts\nconsole.log('hi')\n```",
      });

      insertChunks(libraryStore.db, {
        documentId: doc.id,
        docPath: "docs/intro.md",
        docUri: "gh://demo/repo@main/docs/intro.md",
        docTitle: "Intro",
        drafts: [
          {
            content: "Intro\n\nHello world",
            tokenCount: 10,
            chunkType: "doc",
            contextPath: "demo/repo > Intro",
            title: "Intro",
            preview: "Hello world",
            lineStart: 1,
            lineEnd: 3,
          },
        ],
      });

      const doc2 = upsertDocument(libraryStore.db, {
        sourceId,
        path: "docs/next.md",
        uri: "gh://demo/repo@main/docs/next.md",
        title: "Next",
        hash: "hash-2",
        contentType: "text/markdown",
        versionLabel: "2.x",
        content: "Next release notes",
      });
      insertChunks(libraryStore.db, {
        documentId: doc2.id,
        docPath: "docs/next.md",
        docUri: "gh://demo/repo@main/docs/next.md",
        docTitle: "Next",
        drafts: [
          {
            content: "Next\n\nNext release notes",
            tokenCount: 8,
            chunkType: "doc",
            contextPath: "demo/repo > Next",
            title: "Next",
            preview: "Next release notes",
            lineStart: 1,
            lineEnd: 2,
          },
        ],
      });

      const fts = searchFTS(libraryStore.db, "Hello", 5);
      expect(fts.length).toBeGreaterThan(0);
      const ftsFiltered = searchFTS(libraryStore.db, "Hello", 5, "1.x");
      expect(ftsFiltered.length).toBeGreaterThan(0);
      expect(ftsFiltered.every((row) => row.path === "docs/intro.md")).toBe(true);
      const ftsPunct = searchFTS(libraryStore.db, "next.js 15", 5);
      expect(Array.isArray(ftsPunct)).toBe(true);

      const needing = getChunksNeedingEmbedding(libraryStore.db, "test-model");
      expect(needing.length).toBeGreaterThan(0);

      libraryStore.ensureVecTable(3);
      for (const id of needing) {
        insertEmbedding(libraryStore.db, id, new Float32Array([0.1, 0.2, 0.3]), "test-model");
      }
      const vec = searchVec(libraryStore.db, new Float32Array([0.1, 0.2, 0.3]), 5);
      expect(vec.length).toBeGreaterThan(0);
      const vecFiltered = searchVec(libraryStore.db, new Float32Array([0.1, 0.2, 0.3]), 5, "1.x");
      expect(vecFiltered.length).toBeGreaterThan(0);
      expect(vecFiltered.every((row) => row.path === "docs/intro.md")).toBe(true);

      clearAllEmbeddings(libraryStore.db);
      libraryStore.ensureVecTable(3);
      const vecAfter = searchVec(libraryStore.db, new Float32Array([0.1, 0.2, 0.3]), 1);
      expect(vecAfter.length).toBe(0);

      deactivateMissingDocuments(libraryStore.db, {
        sourceId,
        versionLabel: "1.x",
        keepPaths: [],
      });
      const cleanup = cleanupInactive(libraryStore.db);
      expect(cleanup.documents).toBeGreaterThan(0);
    } finally {
      if (libraryStore) libraryStore.close();
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
