import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createStore, createLibraryStore, type Store } from "../src/store/db";
import { addGithubSource, ensureLibraryDbPath, getSourceById } from "../src/store";

const CLI_PATH = join(process.cwd(), "src", "cli.ts");

async function startClient(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: "bun",
    args: [CLI_PATH, "mcp"],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "librarian-test", version: "0.0.0" });
  await client.connect(transport);
  return { client };
}

function getText(result: { content?: Array<{ type: string; text?: string }> }): string {
  const first = result.content?.[0];
  return first?.text ?? "";
}

describe("mcp", () => {
  test("lists tools", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-mcp-"));
    const env = {
      LIBRARIAN_CONFIG_DIR: join(dir, ".config"),
      LIBRARIAN_CACHE_DIR: join(dir, ".cache"),
      LIBRARIAN_DB_PATH: join(dir, "db.sqlite"),
    };

    const { client } = await startClient(env);
    try {
      const result = await client.listTools();
      const names = result.tools.map((tool) => tool.name);
      expect(names).toContain("search");
      expect(names).toContain("get");
      expect(names).toContain("library");
    } finally {
      await client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runs tools", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-mcp-"));
    const env = {
      LIBRARIAN_CONFIG_DIR: join(dir, ".config"),
      LIBRARIAN_CACHE_DIR: join(dir, ".cache"),
      LIBRARIAN_DB_PATH: join(dir, "db.sqlite"),
    };

    const store = await createStore(env.LIBRARIAN_DB_PATH);
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
    } finally {
      if (libraryStore) libraryStore.close();
      store.close();
    }

    const { client } = await startClient(env);
    try {
      const libraryResult = await client.callTool({
        name: "library",
        arguments: { query: "hello" },
      });
      expect(getText(libraryResult)).toContain("No libraries found.");

      const searchResult = await client.callTool({
        name: "search",
        arguments: { query: "middleware", library: "demo/repo" },
      });
      expect(getText(searchResult)).toContain("No results found.");

      const getResult = await client.callTool({
        name: "get",
        arguments: { library: "demo/repo", docId: 1 },
      });
      expect(getText(getResult)).toContain("Document not found");
    } finally {
      await client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
