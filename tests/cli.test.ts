import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createStore, createLibraryStore, type Store } from "../src/store/db";
import { addGithubSource, ensureLibraryDbPath, getSourceById, insertChunks, upsertDocument } from "../src/store";

const CLI_PATH = join(process.cwd(), "src", "cli.ts");

function runCli(args: string[], cwd: string, env: Record<string, string>) {
  return spawnSync("bun", [CLI_PATH, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

describe("cli", () => {
  test("detect prints versions", () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-cli-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { hono: "^4.0.0" } }),
    );

    const env = {
      LIBRARIAN_CONFIG_DIR: join(dir, ".config"),
      LIBRARIAN_CACHE_DIR: join(dir, ".cache"),
      LIBRARIAN_DB_PATH: join(dir, "db.sqlite"),
    };
    const result = runCli(["detect"], dir, env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Detected versions");
    expect(result.stdout).toContain("hono");
    rmSync(dir, { recursive: true, force: true });
  });

  test("setup noprompt runs without asking", () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-cli-"));
    const env = {
      LIBRARIAN_CONFIG_DIR: join(dir, ".config"),
      LIBRARIAN_CACHE_DIR: join(dir, ".cache"),
      LIBRARIAN_DB_PATH: join(dir, "db.sqlite"),
    };
    const result = runCli(["setup", "--noprompt"], process.cwd(), env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Vector:");
    expect(result.stdout).toContain("Tree parser");
    rmSync(dir, { recursive: true, force: true });
  });

  test("source add with noprompt and no url fails", () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-cli-"));
    const env = {
      LIBRARIAN_CONFIG_DIR: join(dir, ".config"),
      LIBRARIAN_CACHE_DIR: join(dir, ".cache"),
      LIBRARIAN_DB_PATH: join(dir, "db.sqlite"),
    };
    const result = runCli(["source", "add", "github", "--noprompt"], process.cwd(), env);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("GitHub URL");
    rmSync(dir, { recursive: true, force: true });
  });

  test("search returns results from db", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-cli-"));
    const dbPath = join(dir, "db.sqlite");
    const env = {
      LIBRARIAN_CONFIG_DIR: join(dir, ".config"),
      LIBRARIAN_CACHE_DIR: join(dir, ".cache"),
      LIBRARIAN_DB_PATH: dbPath,
    };
    const store = await createStore(dbPath);
    let libraryStore: Store | null = null;
    try {
      const sourceId = addGithubSource(store.db, {
        name: "demo/repo",
        owner: "demo",
        repo: "repo",
        ref: "main",
        versionLabel: "1.x",
      });
      const source = getSourceById(store.db, sourceId);
      if (!source) throw new Error("Expected source");
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
        content: "Hello world",
      });
      insertChunks(libraryStore.db, {
        documentId: doc.id,
        docPath: "docs/intro.md",
        docUri: "gh://demo/repo@main/docs/intro.md",
        docTitle: "Intro",
        drafts: [
          {
            content: "Intro\n\nHello world",
            tokenCount: 5,
            chunkType: "doc",
            contextPath: "demo/repo > Intro",
            title: "Intro",
            preview: "Hello world",
            lineStart: 1,
            lineEnd: 2,
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
            tokenCount: 5,
            chunkType: "doc",
            contextPath: "demo/repo > Next",
            title: "Next",
            preview: "Next release notes",
            lineStart: 1,
            lineEnd: 2,
          },
        ],
      });
    } finally {
      if (libraryStore) libraryStore.close();
      store.close();
    }

    const result = runCli(["search", "--library", "demo/repo", "--mode", "word", "--version", "1.x", "Hello"], process.cwd(), env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Intro");
    rmSync(dir, { recursive: true, force: true });
  });

  test("query --json returns items", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-cli-"));
    const dbPath = join(dir, "db.sqlite");
    const env = {
      LIBRARIAN_CONFIG_DIR: join(dir, ".config"),
      LIBRARIAN_CACHE_DIR: join(dir, ".cache"),
      LIBRARIAN_DB_PATH: dbPath,
    };
    const store = await createStore(dbPath);
    let libraryStore: Store | null = null;
    try {
      const sourceId = addGithubSource(store.db, {
        name: "demo/repo",
        owner: "demo",
        repo: "repo",
        ref: "main",
        versionLabel: "1.x",
      });
      const source = getSourceById(store.db, sourceId);
      if (!source) throw new Error("Expected source");
      const libraryPath = ensureLibraryDbPath(store.db, source);
      libraryStore = await createLibraryStore(libraryPath);
      const doc = upsertDocument(libraryStore.db, {
        sourceId,
        path: "docs/query.md",
        uri: "gh://demo/repo@main/docs/query.md",
        title: "Query",
        hash: "hash-2",
        contentType: "text/markdown",
        versionLabel: "1.x",
        content: "Query text",
      });
      insertChunks(libraryStore.db, {
        documentId: doc.id,
        docPath: "docs/query.md",
        docUri: "gh://demo/repo@main/docs/query.md",
        docTitle: "Query",
        drafts: [
          {
            content: "Query\n\nQuery text",
            tokenCount: 5,
            chunkType: "doc",
            contextPath: "demo/repo > Query",
            title: "Query",
            preview: "Query text",
            lineStart: 1,
            lineEnd: 2,
          },
        ],
      });
    } finally {
      if (libraryStore) libraryStore.close();
      store.close();
    }

    const result = runCli(["query", "--library", "demo/repo", "--json", "Query"], process.cwd(), env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("\"items\"");
    rmSync(dir, { recursive: true, force: true });
  });

  test("get --doc --slice returns slice", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-cli-"));
    const dbPath = join(dir, "db.sqlite");
    const env = {
      LIBRARIAN_CONFIG_DIR: join(dir, ".config"),
      LIBRARIAN_CACHE_DIR: join(dir, ".cache"),
      LIBRARIAN_DB_PATH: dbPath,
    };
    const store = await createStore(dbPath);
    let libraryStore: Store | null = null;
    let docId = 0;
    try {
      const sourceId = addGithubSource(store.db, {
        name: "demo/repo",
        owner: "demo",
        repo: "repo",
        ref: "main",
        versionLabel: "1.x",
      });
      const source = getSourceById(store.db, sourceId);
      if (!source) throw new Error("Expected source");
      const libraryPath = ensureLibraryDbPath(store.db, source);
      libraryStore = await createLibraryStore(libraryPath);
      const doc = upsertDocument(libraryStore.db, {
        sourceId,
        path: "docs/slice.md",
        uri: "gh://demo/repo@main/docs/slice.md",
        title: "Slice",
        hash: "hash-3",
        contentType: "text/markdown",
        versionLabel: "1.x",
        content: "line1\nline2\nline3\nline4",
      });
      docId = doc.id;
    } finally {
      if (libraryStore) libraryStore.close();
      store.close();
    }

    const result = runCli(["get", "--library", "demo/repo", "--doc", String(docId), "--slice", "2:3"], process.cwd(), env);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("line2\nline3");
    rmSync(dir, { recursive: true, force: true });
  });

  test("source list prints sources", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-cli-"));
    const dbPath = join(dir, "db.sqlite");
    const env = {
      LIBRARIAN_CONFIG_DIR: join(dir, ".config"),
      LIBRARIAN_CACHE_DIR: join(dir, ".cache"),
      LIBRARIAN_DB_PATH: dbPath,
    };
    const store = await createStore(dbPath);
    try {
      addGithubSource(store.db, {
        name: "demo/repo",
        owner: "demo",
        repo: "repo",
        ref: "main",
        versionLabel: "1.x",
      });
    } finally {
      store.close();
    }

    const result = runCli(["source", "list"], process.cwd(), env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("demo/repo");
    rmSync(dir, { recursive: true, force: true });
  });

  test("cleanup removes inactive docs", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-cli-"));
    const dbPath = join(dir, "db.sqlite");
    const env = {
      LIBRARIAN_CONFIG_DIR: join(dir, ".config"),
      LIBRARIAN_CACHE_DIR: join(dir, ".cache"),
      LIBRARIAN_DB_PATH: dbPath,
    };
    const store = await createStore(dbPath);
    let libraryStore: Store | null = null;
    try {
      const sourceId = addGithubSource(store.db, {
        name: "demo/repo",
        owner: "demo",
        repo: "repo",
        ref: "main",
        versionLabel: "1.x",
      });
      const source = getSourceById(store.db, sourceId);
      if (!source) throw new Error("Expected source");
      const libraryPath = ensureLibraryDbPath(store.db, source);
      libraryStore = await createLibraryStore(libraryPath);
      const doc = upsertDocument(libraryStore.db, {
        sourceId,
        path: "docs/old.md",
        uri: "gh://demo/repo@main/docs/old.md",
        title: "Old",
        hash: "hash-old",
        contentType: "text/markdown",
        versionLabel: "1.x",
        content: "Old content",
      });
      insertChunks(libraryStore.db, {
        documentId: doc.id,
        docPath: "docs/old.md",
        docUri: "gh://demo/repo@main/docs/old.md",
        docTitle: "Old",
        drafts: [
          {
            content: "Old",
            tokenCount: 1,
            chunkType: "doc",
            contextPath: "demo/repo > Old",
            title: "Old",
          },
        ],
      });
      libraryStore.db.prepare("UPDATE documents SET active = 0 WHERE id = ?").run(doc.id);
    } finally {
      if (libraryStore) libraryStore.close();
      store.close();
    }

    const result = runCli(["cleanup"], process.cwd(), env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Removed documents");
    rmSync(dir, { recursive: true, force: true });
  });

  test("vsearch runs without crashing", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-cli-"));
    const dbPath = join(dir, "db.sqlite");
    const env = {
      LIBRARIAN_CONFIG_DIR: join(dir, ".config"),
      LIBRARIAN_CACHE_DIR: join(dir, ".cache"),
      LIBRARIAN_DB_PATH: dbPath,
    };
    const store = await createStore(dbPath);
    let libraryStore: Store | null = null;
    try {
      const sourceId = addGithubSource(store.db, {
        name: "demo/repo",
        owner: "demo",
        repo: "repo",
        ref: "main",
        versionLabel: "1.x",
      });
      const source = getSourceById(store.db, sourceId);
      if (!source) throw new Error("Expected source");
      const libraryPath = ensureLibraryDbPath(store.db, source);
      libraryStore = await createLibraryStore(libraryPath);
      const doc = upsertDocument(libraryStore.db, {
        sourceId,
        path: "docs/v.md",
        uri: "gh://demo/repo@main/docs/v.md",
        title: "Vec",
        hash: "hash-vec",
        contentType: "text/markdown",
        versionLabel: "1.x",
        content: "Vector content",
      });
      insertChunks(libraryStore.db, {
        documentId: doc.id,
        docPath: "docs/v.md",
        docUri: "gh://demo/repo@main/docs/v.md",
        docTitle: "Vec",
        drafts: [
          {
            content: "Vec\n\nVector content",
            tokenCount: 5,
            chunkType: "doc",
            contextPath: "demo/repo > Vec",
            title: "Vec",
          },
        ],
      });
    } finally {
      if (libraryStore) libraryStore.close();
      store.close();
    }

    const result = runCli(["vsearch", "--library", "demo/repo", "Vector"], process.cwd(), env);
    expect(result.status).toBe(0);
    const combined = (result.stdout + result.stderr).trim();
    if (combined) {
      const ok = combined.includes("No results found.")
        || combined.includes("Vector search is not ready")
        || combined.includes("Results");
      expect(ok).toBe(true);
    }
    rmSync(dir, { recursive: true, force: true });
  });
});
