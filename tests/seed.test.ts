import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { createStore } from "../src/store/db";
import { cmdSeed } from "../src/cli/seed";
import { listSources } from "../src/store";

describe("seed", () => {
  test("adds sources from a seed file without ingest", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-seed-"));
    const seedPath = join(dir, "libraries.yml");
    const previousEnv = {
      LIBRARIAN_CACHE_DIR: process.env.LIBRARIAN_CACHE_DIR,
      LIBRARIAN_DB_PATH: process.env.LIBRARIAN_DB_PATH,
      LIBRARIAN_LIBRARY_DB_DIR: process.env.LIBRARIAN_LIBRARY_DB_DIR,
    };

    process.env.LIBRARIAN_CACHE_DIR = join(dir, "cache");
    process.env.LIBRARIAN_DB_PATH = join(dir, "index.sqlite");
    process.env.LIBRARIAN_LIBRARY_DB_DIR = join(dir, "db");

    writeFileSync(
      seedPath,
      [
        "- name: demo/repo",
        "  type: github",
        "  url: demo/repo",
        "  docs: docs",
        "  ref: main",
        "  version: 1.x",
        "- name: Example Docs",
        "  type: web",
        "  url: https://example.com/docs",
        "  allow: [/docs]",
        "  deny: [/blog]",
        "  depth: 2",
        "  pages: 50",
        "",
      ].join("\n"),
      "utf-8",
    );

    const store = await createStore(process.env.LIBRARIAN_DB_PATH);
    try {
      await cmdSeed(store, ["--file", seedPath, "--no-ingest"]);
      const sources = listSources(store.db);
      expect(sources.length).toBe(2);

      const github = sources.find((source) => source.kind === "github");
      expect(github?.owner).toBe("demo");
      expect(github?.repo).toBe("repo");
      expect(github?.docs_path).toBe("docs");
      expect(github?.ref).toBe("main");
      expect(github?.version_label).toBe("1.x");

      const web = sources.find((source) => source.kind === "web");
      expect(web?.root_url).toBe("https://example.com/docs");
      const allowed = JSON.parse(web?.allowed_paths ?? "[]");
      const denied = JSON.parse(web?.denied_paths ?? "[]");
      expect(allowed).toEqual(["/docs"]);
      expect(denied).toEqual(["/blog"]);
      expect(web?.max_depth).toBe(2);
      expect(web?.max_pages).toBe(50);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
      process.env.LIBRARIAN_CACHE_DIR = previousEnv.LIBRARIAN_CACHE_DIR;
      process.env.LIBRARIAN_DB_PATH = previousEnv.LIBRARIAN_DB_PATH;
      process.env.LIBRARIAN_LIBRARY_DB_DIR = previousEnv.LIBRARIAN_LIBRARY_DB_DIR;
    }
  });
});
