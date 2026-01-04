import type { Store } from "../store/db";
import { createLibraryStore } from "../store/db";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../core/config";
import {
  ensureLibraryDbPath,
  getChunksNeedingEmbedding,
  loadChunkForEmbedding,
  insertEmbedding,
  clearAllEmbeddings,
  getSourceById,
  listSources,
  updateChunkTokenCount,
} from "../store";
import { embedText, formatDocForEmbedding, getDefaultEmbedModel, type EmbeddingUsage } from "../llm/embed";
import { printError } from "./help";

export async function cmdEmbed(store: Store, args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      source: { type: "string" },
      model: { type: "string" },
      force: { type: "boolean" },
      safe: { type: "boolean" },
    },
  });
  const values = parsed.values as { source?: string; model?: string; force?: boolean; safe?: boolean };
  const positional = parsed.positionals.find((entry) => !entry.startsWith("-")) ?? null;
  const modelUri = values.model ?? loadConfig().models?.embed ?? getDefaultEmbedModel();
  const force = Boolean(values.force);
  const safe = Boolean(values.safe || process.env.LIBRARIAN_EMBED_SAFE === "1");

  let sources = listSources(store.db);
  const idRaw = values.source ?? positional;
  if (idRaw) {
    const parsedId = Number.parseInt(String(idRaw), 10);
    if (!Number.isFinite(parsedId)) {
      printError("source id must be a number");
      process.exitCode = 1;
      return;
    }
    const source = getSourceById(store.db, parsedId);
    if (!source) {
      printError("source not found");
      process.exitCode = 1;
      return;
    }
    sources = [source];
  }

  if (sources.length === 0) {
    console.log("No sources found.");
    return;
  }

  if (safe && !process.env.LIBRARIAN_EMBED_CHILD) {
    const exitCode = await runEmbedInChildProcesses(sources, { model: values.model, force });
    if (exitCode !== 0) process.exitCode = exitCode;
    return;
  }

  let totalQueued = 0;
  let totalDone = 0;

  for (const source of sources) {
    const libraryPath = ensureLibraryDbPath(store.db, source);
    const libraryStore = await createLibraryStore(libraryPath);
    try {
      if (force) {
        console.log(`Clearing embeddings for ${source.name}...`);
        clearAllEmbeddings(libraryStore.db);
        libraryStore.ensureVecTable();
      }
      const ids = getChunksNeedingEmbedding(libraryStore.db, modelUri);
      if (ids.length === 0) {
        continue;
      }
      totalQueued += ids.length;
      console.log(`Embedding ${ids.length} chunks for ${source.name}...`);
      for (const id of ids) {
        const row = loadChunkForEmbedding(libraryStore.db, id);
        if (!row) continue;
        const text = formatDocForEmbedding(row.content, row.title);
        const usage: EmbeddingUsage = { tokenCount: 0, originalTokenCount: 0, wasClamped: false };
        const vector = await embedText(text, { model: modelUri, usage });
        libraryStore.ensureVecTable(vector.length);
        insertEmbedding(libraryStore.db, id, vector, modelUri);
        if (usage.tokenCount > 0) {
          updateChunkTokenCount(libraryStore.db, id, usage.tokenCount);
        }
        totalDone += 1;
      }
    } finally {
      libraryStore.close();
    }
  }

  if (totalQueued === 0) {
    console.log("No chunks to embed.");
    return;
  }
  console.log(`Embedded ${totalDone} chunks.`);
}

async function runEmbedInChildProcesses(
  sources: ReturnType<typeof listSources>,
  options: { model?: string; force: boolean },
): Promise<number> {
  const cliPath = fileURLToPath(new URL("../cli.ts", import.meta.url));
  const bunPath = process.execPath;
  let exitCode = 0;

  for (const source of sources) {
    const args: string[] = [cliPath, "embed", "--source", String(source.id)];
    if (options.model) args.push("--model", options.model);
    if (options.force) args.push("--force");

    const code = await runChild(bunPath, args, {
      LIBRARIAN_EMBED_CHILD: "1",
    });
    if (code !== 0) {
      exitCode = code;
    }
  }
  return exitCode;
}

function runChild(
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
