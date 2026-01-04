import { readFileSync } from "node:fs";
import { basename } from "node:path";
import YAML from "yaml";
import type { Store } from "../store/db";
import { getSourceById, listSources } from "../store";
import { cmdSourceAddGithub } from "./source/github";
import { cmdSourceAddWeb } from "./source/web";
import { cmdIngest } from "./ingest";
import { parseGithubUrl } from "../ingest/github/parse";
import { printError } from "./help";
import { parseFlags } from "./flags";

type SeedEntry = {
  name?: string;
  type: "github" | "web";
  url: string;
  docs?: string;
  ref?: string;
  version?: string;
  mode?: string;
  allow?: string[] | string;
  deny?: string[] | string;
  depth?: number;
  pages?: number;
};

export async function cmdSeed(store: Store, args: string[]): Promise<void> {
  const { files, urls, flags, errors } = parseSeedArgs(args);
  if (errors.length > 0) {
    for (const err of errors) {
      printError(err);
    }
    process.exitCode = 1;
    return;
  }

  const noIngest = Boolean(flags["no-ingest"]);
  const noEmbed = Boolean(flags["no-embed"]);
  const sources = listSources(store.db);
  const existingKeys = new Set<string>();
  for (const source of sources) {
    if (source.kind === "github" && source.owner && source.repo) {
      existingKeys.add(`github:${source.owner.toLowerCase()}/${source.repo.toLowerCase()}`);
    }
    if (source.kind === "web" && source.root_url) {
      existingKeys.add(`web:${normalizeUrl(source.root_url)}`);
    }
  }

  const seedEntries: SeedEntry[] = [];
  const loadErrors: string[] = [];

  const defaultPath = new URL("../../data/libraries.yml", import.meta.url);
  const seedFiles = files.length > 0 ? files : [defaultPath];

  for (const file of seedFiles) {
    try {
      const raw = readFileSync(file, "utf-8");
      const parsed = YAML.parse(raw);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          seedEntries.push(entry as SeedEntry);
        }
      } else {
        loadErrors.push(`seed file must be a list: ${formatSeedLabel(file)}`);
      }
    } catch (err) {
      const label = formatSeedLabel(file);
      loadErrors.push(`could not read seed file: ${label}`);
    }
  }

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        loadErrors.push(`could not fetch seed url: ${url}`);
        continue;
      }
      const text = await res.text();
      const parsed = YAML.parse(text);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          seedEntries.push(entry as SeedEntry);
        }
      } else {
        loadErrors.push(`seed url must return a list: ${url}`);
      }
    } catch {
      loadErrors.push(`could not fetch seed url: ${url}`);
    }
  }

  if (loadErrors.length > 0) {
    for (const err of loadErrors) {
      printError(err);
    }
    process.exitCode = 1;
    if (seedEntries.length === 0) return;
  }

  if (seedEntries.length === 0) {
    console.log("No seeds found.");
    return;
  }

  const addedSources: Array<{ id: number; name: string }> = [];
  const seenKeys = new Set<string>();
  let skipped = 0;

  for (const raw of seedEntries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as SeedEntry;
    if (!entry.url || typeof entry.url !== "string") continue;
    if (!entry.type || (entry.type !== "github" && entry.type !== "web")) continue;

    if (entry.type === "github") {
      const normalizedUrl = normalizeGithubUrl(entry.url);
      const parsed = parseGithubUrl(normalizedUrl);
      if (!parsed) {
        printError(`invalid GitHub url: ${entry.url}`);
        continue;
      }
      const key = `github:${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}`;
      if (existingKeys.has(key) || seenKeys.has(key)) {
        console.log(`Skipped ${parsed.owner}/${parsed.repo} (already added)`);
        skipped += 1;
        continue;
      }
      seenKeys.add(key);

      const ghArgs: string[] = [normalizedUrl, "--noprompt"];
      if (entry.name) ghArgs.push("--name", entry.name);
      if (entry.docs) ghArgs.push("--docs", entry.docs);
      if (entry.ref) ghArgs.push("--ref", entry.ref);
      if (entry.version) ghArgs.push("--version", entry.version);
      if (entry.mode) ghArgs.push("--mode", entry.mode);
      const id = await cmdSourceAddGithub(store, ghArgs);
      if (id) addedSources.push({ id, name: entry.name ?? `${parsed.owner}/${parsed.repo}` });
      if (!entry.docs && (entry.mode ?? "docs") !== "repo") {
        console.log("  Note: no docs path set, scanning all doc files.");
      }
      continue;
    }

    if (entry.type === "web") {
      let normalized: string;
      try {
        normalized = normalizeUrl(entry.url);
      } catch {
        printError(`invalid web url: ${entry.url}`);
        continue;
      }
      const key = `web:${normalized}`;
      if (existingKeys.has(key) || seenKeys.has(key)) {
        console.log(`Skipped ${entry.url} (already added)`);
        skipped += 1;
        continue;
      }
      seenKeys.add(key);

      const webArgs: string[] = [];
      if (entry.name) webArgs.push("--name", entry.name);
      if (entry.allow) webArgs.push("--allow", normalizeList(entry.allow));
      if (entry.deny) webArgs.push("--deny", normalizeList(entry.deny));
      if (entry.depth) webArgs.push("--depth", String(entry.depth));
      if (entry.pages) webArgs.push("--pages", String(entry.pages));
      if (entry.version) webArgs.push("--version", entry.version);
      const id = await cmdSourceAddWeb(store, entry.url, webArgs);
      if (id) addedSources.push({ id, name: entry.name ?? entry.url });
    }
  }

  if (addedSources.length === 0) {
    console.log("No new sources added.");
    return;
  }

  if (skipped > 0) {
    console.log(`Skipped ${skipped} already added.`);
  }

  if (noIngest) return;

  const seedConcurrency = resolveSeedConcurrency(flags.concurrency);
  const totals = {
    total: addedSources.length,
    completed: 0,
    failed: 0,
    startedAt: Date.now(),
    concurrency: seedConcurrency,
  };
  const active = new Set<string>();

  const runIngest = async (entry: { id: number; name: string }) => {
    active.add(entry.name);
    logSeedProgress(totals, active);
    let attempts = 0;
    let lastError = "";

    while (true) {
      try {
        const ingestArgs = ["--source", String(entry.id)];
        if (!noEmbed) ingestArgs.push("--embed");
        await cmdIngest(store, ingestArgs);
        const updated = getSourceById(store.db, entry.id);
        lastError = updated?.last_error ?? "";
      } catch (err) {
        lastError = String((err as Error)?.message ?? err ?? "");
      }

      if (lastError && isRateLimitError(lastError) && attempts < 3) {
        const waitMs = getBackoffMs(attempts);
        console.log(`Too many requests. Waiting ${formatDuration(waitMs)} then retrying ${entry.name}.`);
        await sleep(waitMs);
        attempts += 1;
        continue;
      }
      if (lastError) totals.failed += 1;
      break;
    }

    active.delete(entry.name);
    totals.completed += 1;
    logSeedProgress(totals, active);
  };

  await runWithConcurrency(addedSources, seedConcurrency, runIngest);
}

function parseSeedArgs(args: string[]): {
  files: Array<string | URL>;
  urls: string[];
  flags: Record<string, string>;
  errors: string[];
} {
  const files: Array<string | URL> = [];
  const urls: string[] = [];
  const rest: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--file") {
      const value = args[i + 1];
      if (!value) {
        errors.push("--file needs a path");
      } else {
        files.push(value);
        i += 1;
      }
      continue;
    }
    if (arg === "--url") {
      const value = args[i + 1];
      if (!value) {
        errors.push("--url needs a value");
      } else {
        urls.push(value);
        i += 1;
      }
      continue;
    }
    rest.push(arg);
  }

  const flags = parseFlags(rest);
  return { files, urls, flags, errors };
}

function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  const path = url.pathname.replace(/\/$/, "");
  return `${url.origin}${path}`;
}

function normalizeGithubUrl(raw: string): string {
  if (!raw.includes("://") && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)) {
    return `https://github.com/${raw}`;
  }
  return raw;
}

function normalizeList(value: string[] | string): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join(",");
  }
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(",");
}

function formatSeedLabel(file: string | URL): string {
  if (typeof file === "string") return file;
  return basename(file.pathname);
}

function resolveSeedConcurrency(value: string | undefined): number {
  if (!value) return 2;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(3, parsed));
}

function isRateLimitError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("rate limit") ||
    text.includes("too many requests") ||
    text.includes("secondary rate limit") ||
    text.includes("abuse detection") ||
    text.includes("status code: 429") ||
    text.includes(" 429")
  );
}

function getBackoffMs(attempt: number): number {
  const base = 15000;
  const max = 120000;
  return Math.min(max, base * 2 ** attempt);
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function logSeedProgress(
  totals: { total: number; completed: number; failed: number; startedAt: number; concurrency: number },
  active: Set<string>,
): void {
  const elapsedMs = Date.now() - totals.startedAt;
  const remainingMs = estimateRemainingMs(elapsedMs, totals.completed, totals.total, totals.concurrency);
  const remaining = totals.completed === 0 ? "unknown" : formatDuration(remainingMs);
  const activeLabel = formatActiveList(active);
  const failure = totals.failed > 0 ? ` • ${totals.failed} failed` : "";
  console.log(
    `Seed progress: ${totals.completed}/${totals.total} done${failure} • ${formatDuration(elapsedMs)} elapsed • ~${remaining} left • running: ${activeLabel}`,
  );
}

function estimateRemainingMs(elapsedMs: number, completed: number, total: number, concurrency: number): number {
  if (completed <= 0) return 0;
  const perSource = elapsedMs / completed;
  const remaining = total - completed;
  return Math.max(0, (perSource * remaining) / Math.max(1, concurrency));
}

function formatActiveList(active: Set<string>): string {
  if (active.size === 0) return "none";
  const names = Array.from(active.values());
  const short = names.slice(0, 2);
  const remaining = names.length - short.length;
  if (remaining > 0) return `${short.join(", ")} +${remaining} more`;
  return short.join(", ");
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  let active = 0;

  await new Promise<void>((resolve) => {
    const next = () => {
      if (index >= items.length && active === 0) {
        resolve();
        return;
      }
      while (active < limit && index < items.length) {
        const item = items[index];
        index += 1;
        active += 1;
        worker(item)
          .catch(() => {})
          .finally(() => {
            active -= 1;
            next();
          });
      }
    };
    next();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
