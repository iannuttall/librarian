import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

export function getConfigDir(): string {
  return process.env.LIBRARIAN_CONFIG_DIR || join(homedir(), ".config", "librarian");
}

export function getCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return process.env.LIBRARIAN_CACHE_DIR || join(base, "librarian");
}

export function getDefaultDbPath(): string {
  if (process.env.LIBRARIAN_DB_PATH) return process.env.LIBRARIAN_DB_PATH;
  return join(getCacheDir(), "index.sqlite");
}

export function getLibraryDbDir(): string {
  return process.env.LIBRARIAN_LIBRARY_DB_DIR || join(getCacheDir(), "db");
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function ensureFileDir(path: string): void {
  ensureDir(dirname(path));
}
