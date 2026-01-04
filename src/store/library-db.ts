import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { ensureDir, getLibraryDbDir } from "../core/paths";
import type { SourceRow } from "./types";
import { updateSourceDbPath } from "./sources";

export function ensureLibraryDbPath(db: Database, source: SourceRow): string {
  if (source.db_path) return source.db_path;
  const path = buildLibraryDbPath(source);
  updateSourceDbPath(db, source.id, path);
  source.db_path = path;
  return path;
}

export function buildLibraryDbPath(source: SourceRow): string {
  ensureDir(getLibraryDbDir());
  const slug = buildLibrarySlug(source);
  return join(getLibraryDbDir(), `${slug}.sqlite`);
}

function buildLibrarySlug(source: SourceRow): string {
  const base = source.owner && source.repo
    ? `${source.owner}-${source.repo}`
    : source.name || "library";
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  const safe = cleaned || "library";
  return `${safe}-${source.id}`;
}
