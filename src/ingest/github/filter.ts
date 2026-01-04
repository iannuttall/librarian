import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import picomatch from "picomatch";

import type { ExtractedFile, LoadedFile, SkippedFile } from "./types";

export type FilterOptions = {
  extensions?: string[];
  include?: string[];
  exclude?: string[];
  maxFileBytes?: number;
};

export type PathFilterDecision = {
  ok: boolean;
  ext?: string;
  reason?: "file_too_large";
};

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

const DEFAULT_TEXT_EXTS = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "md",
  "mdx",
  "txt",
  "rst",
  "adoc",
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "htm",
  "vue",
  "svelte",
  "astro",
  "pug",
  "py",
  "pyi",
  "pyx",
  "rb",
  "r",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "scala",
  "swift",
  "php",
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hh",
  "hpp",
  "cs",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "cmd",
  "make",
  "mk",
  "gradle",
  "groovy",
  "rake",
  "gemspec",
  "sql",
  "graphql",
  "gql",
  "proto",
  "lua",
  "dockerfile",
]);

const SKIP_DIR_PARTS = new Set([
  ".git",
  ".github",
  ".gitlab",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".parcel-cache",
  ".cache",
  "__pycache__",
  ".pytest_cache",
  ".ruff_cache",
  ".idea",
  ".vscode",
  ".pnpm-store",
  ".yarn",
  ".husky",
  ".changeset",
  "out",
  "coverage",
  "tmp",
  "vendor",
  "storybook-static",
  "logs",
  "log",
  "obj",
  "bin",
]);
const SKIP_FILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "cargo.lock",
  "worker-configuration.d.ts",
  "composer.lock",
  "poetry.lock",
  "pipfile.lock",
  "coverage-final.json",
  "report.html",
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
]);
const SKIP_EXT_ALWAYS = new Set([
  "svg",
  "xml",
  "csv",
  "tsv",
  "map",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "avif",
  "ico",
  "tif",
  "tiff",
  "heic",
  "heif",
  "pdf",
  "mp3",
  "wav",
  "flac",
  "ogg",
  "mp4",
  "mov",
  "mkv",
  "webm",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "pages",
  "numbers",
  "key",
  "psd",
  "ai",
  "sketch",
  "fig",
  "exe",
  "dll",
  "so",
  "dylib",
  "a",
  "o",
  "obj",
  "jar",
  "war",
  "ear",
  "apk",
  "ipa",
  "app",
  "dmg",
  "iso",
  "parquet",
  "feather",
  "h5",
  "hdf5",
  "npy",
  "pkl",
  "orc",
  "avro",
  "sav",
  "dta",
  "rds",
  "rdata",
  "sas7bdat",
  "mat",
  "bak",
  "sqlite",
  "sqlite3",
  "db",
  "zip",
  "gz",
  "tgz",
  "rar",
  "7z",
  "bz2",
  "xz",
  "tar",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "wasm",
]);
const SKIP_PATH_SUFFIXES: string[] = [
  ".min.js",
  ".min.mjs",
  ".min.cjs",
  ".min.ts",
  ".min.tsx",
  ".min.jsx",
  ".min.css",
  ".bundle.js",
  ".bundle.css",
  ".log",
  ".bak",
  ".backup",
  ".old",
  ".orig",
  "~",
];
const SKIP_PATH_SUBSTRINGS: string[] = [
  "cypress/videos/",
  "cypress/screenshots/",
  "backup/",
  "backups/",
];

const SPECIAL_FILE_NAMES = new Set([
  "Dockerfile",
  "Makefile",
  "Rakefile",
  "Gemfile",
]);

export async function filterAndLoadFiles(
  files: ExtractedFile[],
  opts: FilterOptions = {},
  onFile?: (file: LoadedFile) => Promise<void> | void,
): Promise<{ loaded: LoadedFile[]; skipped: SkippedFile[] }> {
  const pathFilter = createPathFilter(opts);
  const skipped: SkippedFile[] = [];
  const loaded: LoadedFile[] = [];

  for (const file of files) {
    const relPath = file.relPath.replace(/\\/g, "/");
    const stat = await fs.stat(file.absPath).catch(() => null);
    if (!stat) continue;
    const decision = pathFilter(relPath, stat.size);
    if (!decision.ok) {
      if (decision.reason === "file_too_large") {
        skipped.push({
          relPath,
          size: stat.size,
          maxBytes: opts.maxFileBytes ?? DEFAULT_MAX_BYTES,
          reason: "file_too_large",
        });
      }
      continue;
    }
    const ext = decision.ext ?? "";
    const content = await fs.readFile(file.absPath, "utf-8");
    const hash = createHash("sha256").update(content).digest("hex");
    const lang = ext || undefined;
    const loadedFile: LoadedFile = {
      relPath,
      content,
      lang,
      hash,
      byteSize: stat.size,
    };

    if (onFile) {
      await onFile(loadedFile);
    } else {
      loaded.push(loadedFile);
    }
  }

  return { loaded, skipped };
}

export function createPathFilter(opts: FilterOptions = {}) {
  const allowExts = normalizeExtensionSet(opts.extensions);
  const includeMatchers = compileGlobs(opts.include);
  const excludeMatchers = compileGlobs(opts.exclude);
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_BYTES;

  return (relPath: string, size?: number | null): PathFilterDecision => {
    const normalized = relPath.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);

    for (const part of parts) {
      if (part === ".") continue;
      if (part.startsWith(".")) return { ok: false };
      const lowerPart = part.toLowerCase();
      if (SKIP_DIR_PARTS.has(lowerPart)) return { ok: false };
    }

    const base = parts[parts.length - 1] ?? normalized;
    const lowerBase = base.toLowerCase();
    if (SKIP_FILE_NAMES.has(lowerBase)) return { ok: false };

    const lowerPath = normalized.toLowerCase();
    if (SKIP_PATH_SUFFIXES.some((suffix) => lowerPath.endsWith(suffix))) return { ok: false };
    if (SKIP_PATH_SUBSTRINGS.some((part) => lowerPath.includes(part))) return { ok: false };

    const ext = extensionFromBasename(base);
    if (ext && SKIP_EXT_ALWAYS.has(ext)) return { ok: false };

    const isSpecialName = SPECIAL_FILE_NAMES.has(base);
    if (!ext && !isSpecialName) return { ok: false };

    if (allowExts) {
      if (!ext) return { ok: false };
      if (!allowExts.has(ext)) return { ok: false };
    } else if (ext && !DEFAULT_TEXT_EXTS.has(ext) && !isSpecialName) {
      return { ok: false };
    }

    if (includeMatchers.length > 0 && !includeMatchers.some((m) => m(normalized))) return { ok: false };
    if (excludeMatchers.length > 0 && excludeMatchers.some((m) => m(normalized))) return { ok: false };

    if (size !== null && size !== undefined && size > maxFileBytes) {
      return { ok: false, ext, reason: "file_too_large" };
    }

    return { ok: true, ext };
  };
}

function normalizeExtensionSet(exts?: string[]): Set<string> | null {
  if (!exts || exts.length === 0) return null;
  return new Set(
    exts
      .map((ext) => ext.trim().toLowerCase().replace(/^\./, ""))
      .filter(Boolean),
  );
}

function compileGlobs(globs?: string[]) {
  if (!globs || globs.length === 0) return [] as Array<(input: string) => boolean>;
  return globs
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => picomatch(pattern, { dot: true }));
}

function extensionFromBasename(basename: string): string {
  const lower = basename.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  const parts = lower.split(".");
  if (parts.length <= 1) return "";
  return parts[parts.length - 1] ?? "";
}
