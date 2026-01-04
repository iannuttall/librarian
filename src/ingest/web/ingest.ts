import type { Database } from "bun:sqlite";
import { sha256Hex } from "../../utils/hash";
import { buildDocumentChunks } from "../../chunk";
import { containsCodeSnippet } from "../../chunk/utils";
import {
  deleteChunksForDocument,
  deactivateMissingDocuments,
  insertChunks,
  upsertDocument,
  getPendingCrawlPages,
  countCrawlPages,
  upsertCrawlPage,
  updateCrawlPageStatus,
  clearCrawlPages,
} from "../../store";
import type { SourceRow, CrawlPageRow } from "../../store";
import { WebsiteCrawler, createHeadlessRenderer } from "./crawler";
import { discoverUrls } from "./sitemap";
import type { CrawlConfig } from "./types";
import { createDefaultCrawlConfig } from "./types";
import { DEFAULT_INGEST_CONCURRENCY } from "../concurrency";

const SKIPPABLE_ERRORS = [
  "Document missing code snippets",
  "Document too small after sanitization",
  "404",
  "410",
];

export interface WebIngestOptions {
  force?: boolean;
  concurrency?: number;
  proxyEndpoint?: string;
  headlessProxy?: string;
  headlessEnabled?: boolean;
  chromePath?: string;
  onProgress?: (progress: WebIngestProgress) => void;
}

export interface WebIngestProgress {
  phase: "discovery" | "crawl";
  current: number;
  total: number;
  url?: string;
  status?: "success" | "skip" | "error";
  message?: string;
}

export interface WebIngestResult {
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  versionLabel: string;
}

export async function ingestWebSource(
  db: Database,
  source: SourceRow,
  options: WebIngestOptions = {},
): Promise<WebIngestResult> {
  if (!source.root_url) {
    throw new Error("Source is missing root_url");
  }

  const force = options.force ?? false;
  const concurrency = options.concurrency ?? DEFAULT_INGEST_CONCURRENCY;
  const proxyEndpoint = options.proxyEndpoint;
  const onProgress = options.onProgress;

  const versionLabel = source.version_label ?? "latest";

  // Build crawler config from source
  const config = buildCrawlConfig(source);

  // Create headless renderer if enabled
  const headlessRenderer = await createHeadlessRenderer({
    enabled: options.headlessEnabled ?? true,
    chromePath: options.chromePath,
    proxy: options.headlessProxy,
  });

  // Create crawler instance
  const crawler = new WebsiteCrawler(proxyEndpoint, headlessRenderer ?? undefined);

  // Clear existing pages if force
  if (force) {
    clearCrawlPages(db, source.id);
  }

  // Discovery phase
  onProgress?.({ phase: "discovery", current: 0, total: 0, message: "Discovering URLs..." });

  const normalizedRoot = crawler.normalizeUrl(source.root_url) ?? source.root_url;
  const discovery = await discoverUrls(normalizedRoot, proxyEndpoint);

  onProgress?.({
    phase: "discovery",
    current: 0,
    total: discovery.urls.length,
    message: `Found ${discovery.urls.length} URLs (llms.txt: ${discovery.llmsTxtFound}, sitemap: ${discovery.sitemapFound})`,
  });

  // Seed crawl pages
  const normalizedUrls = discovery.urls
    .map((u) => crawler.normalizeUrl(u))
    .filter((u): u is string => u !== null);

  // Always include root
  if (!normalizedUrls.includes(normalizedRoot)) {
    normalizedUrls.unshift(normalizedRoot);
  }

  let seeded = 0;
  for (const url of normalizedUrls) {
    const depth = url === normalizedRoot ? 0 : 1;
    const result = upsertCrawlPage(db, {
      sourceId: source.id,
      url,
      normalizedUrl: url,
      depth,
    });
    if (result.created) seeded++;
  }

  onProgress?.({
    phase: "discovery",
    current: seeded,
    total: seeded,
    message: `Seeded ${seeded} pages`,
  });

  // Crawl phase with concurrent pool
  let result: { processed: number; updated: number; skipped: number; failed: number };
  try {
    result = await crawlWithPool(db, source, crawler, config, versionLabel, {
      concurrency,
      onProgress,
    });
  } finally {
    // Clean up headless browser
    if (headlessRenderer) {
      await headlessRenderer.close();
    }
  }

  return {
    processed: result.processed,
    updated: result.updated,
    skipped: result.skipped,
    failed: result.failed,
    versionLabel,
  };
}

async function crawlWithPool(
  db: Database,
  source: SourceRow,
  crawler: WebsiteCrawler,
  config: CrawlConfig,
  versionLabel: string,
  options: {
    concurrency: number;
    onProgress?: (progress: WebIngestProgress) => void;
  },
): Promise<{ processed: number; updated: number; skipped: number; failed: number }> {
  const { concurrency, onProgress } = options;
  const keepPaths: string[] = [];
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  const prefix = buildPrefix(source.root_url ?? "");

  while (true) {
    const counts = countCrawlPages(db, source.id);
    const pending = getPendingCrawlPages(db, source.id, concurrency);

    if (pending.length === 0) break;
    if (counts.total >= config.maxPages && counts.pending === 0) break;

    onProgress?.({
      phase: "crawl",
      current: counts.done,
      total: counts.total,
      message: `Crawling... (${counts.done}/${counts.total})`,
    });

    // Process batch concurrently
    const results = await Promise.allSettled(
      pending.map((page) => processPage(db, source, crawler, config, page, versionLabel, prefix)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const page = pending[i];
      if (!result || !page) continue;

      if (result.status === "fulfilled") {
        const { status, path, newLinks } = result.value;

        if (status === "success") {
          processed++;
          updated++;
          if (path) keepPaths.push(path);
          updateCrawlPageStatus(db, page.id, "done");

          // Enqueue discovered links
          if (newLinks?.length) {
            const currentCounts = countCrawlPages(db, source.id);
            for (const link of newLinks) {
              if (currentCounts.total >= config.maxPages) break;

              const depth = page.depth + 1;
              if (depth > config.maxDepth) continue;

              const normalized = crawler.normalizeUrl(link);
              if (!normalized || !crawler.inScope(normalized, config)) continue;

              upsertCrawlPage(db, {
                sourceId: source.id,
                url: normalized,
                normalizedUrl: normalized,
                depth,
              });
            }
          }

          onProgress?.({
            phase: "crawl",
            current: processed,
            total: counts.total,
            url: page.url,
            status: "success",
          });
        } else if (status === "skip") {
          skipped++;
          updateCrawlPageStatus(db, page.id, "done", result.value.error);
          onProgress?.({
            phase: "crawl",
            current: processed,
            total: counts.total,
            url: page.url,
            status: "skip",
            message: result.value.error,
          });
        }
      } else {
        failed++;
        const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
        updateCrawlPageStatus(db, page.id, "failed", error);
        onProgress?.({
          phase: "crawl",
          current: processed,
          total: counts.total,
          url: page.url,
          status: "error",
          message: error,
        });
      }
    }
  }

  // Deactivate documents not in this crawl
  deactivateMissingDocuments(db, {
    sourceId: source.id,
    versionLabel,
    keepPaths,
  });

  return { processed, updated, skipped, failed };
}

async function processPage(
  db: Database,
  source: SourceRow,
  crawler: WebsiteCrawler,
  config: CrawlConfig,
  page: CrawlPageRow,
  versionLabel: string,
  prefix: string[],
): Promise<{ status: "success" | "skip"; path?: string; newLinks?: string[]; error?: string }> {
  updateCrawlPageStatus(db, page.id, "fetching");

  // Handle llms.txt manifest files
  if (crawler.isLlmsManifest(page.url)) {
    const links = await crawler.fetchLlmsManifest(page.url, config);
    return { status: "success", newLinks: links };
  }

  try {
    const result = await crawler.fetch(page.url, config);

    if (!containsCodeSnippet(result.markdown)) {
      return { status: "skip", error: "No code snippets" };
    }

    const hash = sha256Hex(result.markdown);
    const uri = `web://${new URL(page.url).host}${result.path}`;

    const doc = upsertDocument(db, {
      sourceId: source.id,
      path: result.path,
      uri,
      title: result.title ?? result.path,
      hash,
      contentType: "text/markdown",
      versionLabel,
      content: result.markdown,
    });

    if (doc.changed) {
      deleteChunksForDocument(db, doc.id);
      const drafts = await buildDocumentChunks({
        content: result.markdown,
        filePath: result.path,
        title: result.title ?? result.path,
        prefix,
      });

      if (drafts.length > 0) {
        insertChunks(db, {
          documentId: doc.id,
          docPath: result.path,
          docUri: uri,
          docTitle: result.title ?? result.path,
          drafts,
        });
      }
    }

    return { status: "success", path: result.path, newLinks: result.links };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (SKIPPABLE_ERRORS.some((e) => message.includes(e))) {
      return { status: "skip", error: message };
    }
    throw err;
  }
}

function buildCrawlConfig(source: SourceRow): CrawlConfig {
  const rootUrl = source.root_url ?? "";
  const base = createDefaultCrawlConfig(rootUrl);

  let allowedPaths = base.allowedPaths;
  let deniedPaths = base.deniedPaths;

  if (source.allowed_paths) {
    try {
      allowedPaths = JSON.parse(source.allowed_paths);
    } catch {
      // ignore
    }
  }

  if (source.denied_paths) {
    try {
      deniedPaths = JSON.parse(source.denied_paths);
    } catch {
      // ignore
    }
  }

  return {
    ...base,
    allowedPaths,
    deniedPaths,
    maxDepth: source.max_depth ?? base.maxDepth,
    maxPages: source.max_pages ?? base.maxPages,
  };
}

function buildPrefix(rootUrl: string): string[] {
  try {
    const parsed = new URL(rootUrl);
    return [parsed.host];
  } catch {
    return [];
  }
}
