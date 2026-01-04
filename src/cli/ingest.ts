import type { Store } from "../store/db";
import { createLibraryStore } from "../store/db";
import { parseArgs } from "node:util";
import readline from "node:readline";
import { addSourceVersion, ensureLibraryDbPath, listSources, getSourceById, updateSourceSync, listSourceVersions } from "../store";
import { ingestGithubSource } from "../ingest/github/ingest";
import { ingestWebSource } from "../ingest/web/ingest";
import { loadConfig } from "../core/config";
import { resolveIngestConcurrency } from "../ingest/concurrency";
import { fetchRepoInfo, fetchStableTags } from "../ingest/github/api";
import { extractMajorVersion, getLatestTagByMajor, parseSeriesLabel, pickLatestForSeries } from "../ingest/github/versioning";
import { cmdEmbed } from "./embed";
import { printError } from "./help";

export async function cmdIngest(store: Store, args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      source: { type: "string" },
      embed: { type: "boolean" },
      force: { type: "boolean" },
      concurrency: { type: "string" },
    },
  });
  const values = parsed.values as { source?: string; embed?: boolean; force?: boolean; concurrency?: string };
  const positional = parsed.positionals.find((entry) => !entry.startsWith("-")) ?? null;
  let id: number | null = null;
  const idRaw = values.source ?? positional ?? null;
  if (idRaw) {
    const parsedId = Number.parseInt(String(idRaw), 10);
    if (!Number.isFinite(parsedId)) {
      printError("source id must be a number");
      process.exitCode = 1;
      return;
    }
    id = parsedId;
  }
  const runEmbed = Boolean(values.embed);
  const force = Boolean(values.force);
  const concurrency = resolveIngestConcurrency(values.concurrency);
  const config = loadConfig();
  const sources = id ? [getSourceById(store.db, id)].filter(Boolean) : listSources(store.db);
  if (sources.length === 0) {
    console.log("No sources to ingest.");
    return;
  }

  for (const source of sources) {
    if (!source) continue;
    try {
      if (source.kind === "github") {
        const libraryPath = ensureLibraryDbPath(store.db, source);
        const libraryStore = await createLibraryStore(libraryPath);
        const versionPlan = await buildGithubVersionPlan(store.db, source, config);
        let lastCommit: string | null = null;
        let lastEtag: string | null = null;
        let lastError: string | null = null;
        try {
          for (const plan of versionPlan) {
            try {
              console.log(`Ingesting ${source.name} @${plan.versionLabel}...`);
              let showedProgress = false;
              const result = await ingestGithubSource(libraryStore.db, source, {
                force,
                concurrency,
                refOverride: plan.ref,
                versionLabelOverride: plan.versionLabel,
                previousSha: plan.previousSha,
                previousEtag: plan.previousEtag,
                onProgress: (progress) => {
                  showedProgress = true;
                  writeProgress(`  Files: ${progress.current}/${progress.total}`);
                },
              });
              if (showedProgress && process.stdout.isTTY) {
                process.stdout.write("\n");
              }
              addSourceVersion(store.db, {
                sourceId: source.id,
                versionLabel: result.versionLabel,
                ref: result.ref,
                commitSha: result.commitSha,
                treeHash: result.treeHash,
                etag: result.etag,
              });
              lastCommit = result.commitSha ?? lastCommit;
              lastEtag = result.etag ?? lastEtag;
              console.log(
                `Done. files=${result.processed} updated=${result.updated} unchanged=${result.unchanged} skipped=${result.skipped}`,
              );
            } catch (err) {
              const message = String((err as Error)?.message ?? err);
              lastError = message;
              console.log(`Error: ${message}`);
            }
          }
          updateSourceSync(store.db, source.id, {
            lastSyncAt: new Date().toISOString(),
            lastCommit,
            lastEtag,
            lastError,
          });
        } finally {
          libraryStore.close();
        }
      } else if (source.kind === "web") {
        const libraryPath = ensureLibraryDbPath(store.db, source);
        const libraryStore = await createLibraryStore(libraryPath);
        console.log(`Crawling ${source.name}...`);
        try {
          const result = await ingestWebSource(libraryStore.db, source, {
            force,
            concurrency,
            proxyEndpoint: config.proxy?.endpoint,
            headlessEnabled: config.headless?.enabled ?? true,
            headlessProxy: config.headless?.proxy,
            chromePath: config.headless?.chromePath,
            onProgress: (progress) => {
              if (progress.phase === "discovery") {
                writeProgress(`  Discovery: ${progress.message ?? "..."}`);
              } else {
                const status = progress.status === "error" ? " (error)" : progress.status === "skip" ? " (skip)" : "";
                writeProgress(`  Crawl: ${progress.current}/${progress.total}${status}`);
              }
            },
          });
          process.stdout.write("\n");
          addSourceVersion(store.db, {
            sourceId: source.id,
            versionLabel: result.versionLabel,
          });
          updateSourceSync(store.db, source.id, {
            lastSyncAt: new Date().toISOString(),
            lastError: null,
          });
          console.log(
            `Done. processed=${result.processed} updated=${result.updated} skipped=${result.skipped} failed=${result.failed}`,
          );
        } finally {
          libraryStore.close();
        }
      } else {
        console.log(`Skipping source ${source.id} (unknown kind: ${source.kind})`);
      }
    } catch (err) {
      updateSourceSync(store.db, source.id, {
        lastSyncAt: new Date().toISOString(),
        lastError: String((err as Error)?.message ?? err),
      });
      console.log(`Error: ${String((err as Error)?.message ?? err)}`);
    }
  }

  if (runEmbed) {
    await cmdEmbed(store, []);
  }
}

function writeProgress(line: string): void {
  if (!process.stdout.isTTY) {
    process.stdout.write(`${line}\n`);
    return;
  }
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(line);
}

async function buildGithubVersionPlan(
  db: Store["db"],
  source: { id: number; owner: string | null; repo: string | null; ref: string | null; version_label: string | null },
  config: ReturnType<typeof loadConfig>,
): Promise<Array<{ versionLabel: string; ref: string; previousSha: string | null; previousEtag: string | null }>> {
  if (!source.owner || !source.repo) return [];

  const versionRows = listSourceVersions(db, source.id);
  const versionMeta = new Map<string, { ref: string | null; commit_sha: string | null; etag: string | null }>();
  for (const row of versionRows) {
    if (!versionMeta.has(row.version_label)) {
      versionMeta.set(row.version_label, { ref: row.ref, commit_sha: row.commit_sha, etag: row.etag });
    }
  }

  const labels = new Set<string>();
  for (const key of versionMeta.keys()) labels.add(key);
  if (source.version_label) labels.add(source.version_label);
  if (labels.size === 0) {
    if (source.ref) labels.add(extractMajorVersion(source.ref) || source.ref);
    else labels.add("HEAD");
  }

  const tags = await fetchStableTags(source.owner, source.repo, config.github?.token);
  const tagNames = tags.map((t) => t.name);
  const majorMap = getLatestTagByMajor(tagNames);
  const maxMajors = config.ingest?.maxMajorVersions ?? 3;
  const majorLabels = Array.from(majorMap.keys())
    .sort((a, b) => b - a)
    .slice(0, Math.max(0, maxMajors))
    .map((major) => `${major}.x`);
  for (const label of majorLabels) {
    labels.add(label);
  }

  let defaultBranch: string | null = null;
  const sortedLabels = sortVersionLabels(Array.from(labels));
  const plan: Array<{ versionLabel: string; ref: string; previousSha: string | null; previousEtag: string | null }> = [];

  for (const label of sortedLabels) {
    const meta = versionMeta.get(label);
    let ref: string | null = null;

    if (parseSeriesLabel(label) !== null && tagNames.length > 0) {
      ref = pickLatestForSeries({ tags: tagNames, seriesLabel: label });
    }
    if (!ref) ref = meta?.ref ?? null;
    if (!ref && source.version_label === label && source.ref) ref = source.ref;
    if (!ref && source.ref) ref = source.ref;
    if (!ref) {
      if (!defaultBranch) {
        const info = await fetchRepoInfo(source.owner, source.repo, config.github?.token);
        defaultBranch = info?.defaultBranch ?? "main";
      }
      ref = defaultBranch ?? "main";
    }

    plan.push({
      versionLabel: label,
      ref,
      previousSha: meta?.commit_sha ?? null,
      previousEtag: meta?.etag ?? null,
    });
  }

  return plan;
}

function sortVersionLabels(labels: string[]): string[] {
  const series: Array<{ label: string; major: number }> = [];
  const other: string[] = [];
  for (const label of labels) {
    const major = parseSeriesLabel(label);
    if (major === null) other.push(label);
    else series.push({ label, major });
  }
  series.sort((a, b) => b.major - a.major);
  other.sort((a, b) => a.localeCompare(b));
  return [...series.map((item) => item.label), ...other];
}
