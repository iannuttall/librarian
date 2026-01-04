import { promises as fs } from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { unzipSync } from "fflate";
import type { ExtractedFile } from "./types";

export type ExtractResult = {
  tempDir: string;
  topLevelDir?: string;
};

export async function extractToTemp(zip: Uint8Array): Promise<ExtractResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "librarian-gh-"));
  const entries = await unzipArchive(zip);
  const names = Object.keys(entries);
  const topPrefix = guessTopPrefix(names);

  await Promise.all(
    Object.entries(entries).map(async ([entryPath, data]) => {
      if (!entryPath || entryPath.endsWith("/")) return;
      let rel = entryPath;
      if (topPrefix && rel.startsWith(topPrefix)) rel = rel.slice(topPrefix.length);
      if (!rel) return;
      const safe = sanitize(rel);
      if (!safe) return;
      const target = path.join(tempDir, safe);
      const parent = path.dirname(target);
      await fs.mkdir(parent, { recursive: true });
      await fs.writeFile(target, data as Uint8Array);
    }),
  );

  return {
    tempDir,
    topLevelDir: topPrefix ? topPrefix.replace(/\/+$/, "") : undefined,
  };
}

export async function listFiles(root: string, basePath?: string): Promise<ExtractedFile[]> {
  const base = basePath ? path.join(root, basePath) : root;
  const results: ExtractedFile[] = [];

  async function walk(current: string) {
    let entries: string[];
    try {
      entries = await fs.readdir(current);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = path.join(current, name);
      const stat = await fs.lstat(abs).catch(() => null);
      if (!stat) continue;
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!stat.isFile()) continue;
      const rel = path.relative(root, abs);
      results.push({ absPath: abs, relPath: rel.replace(/\\/g, "/") });
    }
  }

  await walk(base);
  results.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return results;
}

export async function cleanupTemp(tempDir: string) {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

async function unzipArchive(zip: Uint8Array): Promise<Record<string, Uint8Array>> {
  try {
    const out = unzipSync(zip);
    return out as Record<string, Uint8Array>;
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

function guessTopPrefix(keys: string[]): string | null {
  if (!keys.length) return null;
  const first = keys[0];
  const idx = first.indexOf("/");
  if (idx > 0) {
    const prefix = first.slice(0, idx + 1);
    if (keys.every((k) => k.startsWith(prefix))) return prefix;
  }
  return null;
}

function sanitize(relPath: string): string | null {
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\))+/g, "");
  if (!normalized) return null;
  if (path.isAbsolute(normalized)) return null;
  return normalized.replace(/\\/g, "/");
}
