import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";

type LibraryRow = {
  id: number;
  slug?: string | null;
  title?: string | null;
  version_label?: string | null;
  default_ref?: string | null;
};

type SourceRow = {
  library_id: number;
  provider: string;
  kind: string;
  owner?: string | null;
  repo?: string | null;
  ref?: string | null;
  docs_path?: string | null;
  root_url?: string | null;
  allowed_paths?: string | string[] | null;
  denied_paths?: string | string[] | null;
  max_depth?: number | null;
  max_pages?: number | null;
};

type SeedEntry = {
  name: string;
  type: "github" | "web";
  url: string;
  docs?: string;
  ref?: string;
  version?: string;
  mode?: string;
  allow?: string[];
  deny?: string[];
  depth?: number;
  pages?: number;
};

const [libsPath, sourcesPath, outPath] = process.argv.slice(2);
if (!libsPath || !sourcesPath) {
  console.error("Usage: bun scripts/convert-seeds.ts <libraries.json> <library_sources.json> [out.yml]");
  process.exit(1);
}

const libs = JSON.parse(readFileSync(libsPath, "utf-8")) as LibraryRow[];
const sources = JSON.parse(readFileSync(sourcesPath, "utf-8")) as SourceRow[];

const libsById = new Map<number, LibraryRow>();
for (const lib of libs) {
  libsById.set(lib.id, lib);
}

const entries: SeedEntry[] = [];
const seen = new Set<string>();

for (const source of sources) {
  const lib = libsById.get(source.library_id);
  if (!lib) continue;
  const name = (lib.title || lib.slug || "").trim();
  if (!name) continue;

  const isGithub = source.provider === "github";
  if (isGithub) {
    if (!source.owner || !source.repo) continue;
    const url = `https://github.com/${source.owner}/${source.repo}`;
    const key = `github:${source.owner.toLowerCase()}/${source.repo.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const entry: SeedEntry = { name, type: "github", url };
    const docsPath = source.docs_path?.trim();
    if (docsPath) entry.docs = docsPath;
    const ref = source.ref || lib.default_ref;
    if (ref) entry.ref = ref;
    if (lib.version_label) entry.version = lib.version_label;
    entries.push(entry);
    continue;
  }

  if (source.root_url) {
    const url = source.root_url;
    const key = `web:${normalizeUrl(url)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const entry: SeedEntry = { name, type: "web", url };
    const allow = parsePathList(source.allowed_paths);
    const deny = parsePathList(source.denied_paths);
    if (allow.length > 0) entry.allow = allow;
    if (deny.length > 0) entry.deny = deny;
    if (source.max_depth) entry.depth = source.max_depth;
    if (source.max_pages) entry.pages = source.max_pages;
    if (lib.version_label) entry.version = lib.version_label;
    entries.push(entry);
  }
}

entries.sort((a, b) => a.name.localeCompare(b.name));

const header = [
  "# Librarian seed sources",
  "# Format:",
  "# - name: vercel/next.js",
  "#   type: github",
  "#   url: https://github.com/vercel/next.js",
  "#   docs: docs",
  "#",
  "# Optional fields:",
  "#   ref: main",
  "#   version: 16.x",
  "#   mode: docs|repo",
  "#   allow: [/docs, /api]",
  "#   deny: [/blog]",
  "#   depth: 3",
  "#   pages: 500",
  "",
].join("\n");

const yaml = YAML.stringify(entries, { indent: 2, lineWidth: 0 });
const output = `${header}${yaml}`;
const target = outPath ? resolve(outPath) : resolve("data/libraries.yml");
writeFileSync(target, output, "utf-8");
console.log(`Wrote ${entries.length} seeds to ${target}`);

function parsePathList(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    // ignore
  }
  return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return raw;
  }
}
