import { loadConfig } from "../../core/config";
import { sha256Hex } from "../../utils/hash";
import { buildDocumentChunks } from "../../chunk";
import { containsCodeSnippet } from "../../chunk/utils";
import { deleteChunksForDocument, deactivateMissingDocuments, insertChunks, upsertDocument } from "../../store";
import type { SourceRow } from "../../store";
import type { Database } from "bun:sqlite";
import { syncGithubRepo } from "./sync";
import { DEFAULT_INGEST_CONCURRENCY, runWithConcurrency } from "../concurrency";

const DOC_EXTENSIONS = ["md", "mdx", "markdown", "rst", "adoc", "txt"];

function isDocFile(path: string): boolean {
  const parts = path.toLowerCase().split(".");
  if (parts.length <= 1) return false;
  const ext = parts[parts.length - 1] ?? "";
  return DOC_EXTENSIONS.includes(ext);
}

export async function ingestGithubSource(
  db: Database,
  source: SourceRow,
  options?: {
    force?: boolean;
    concurrency?: number;
    refOverride?: string | null;
    versionLabelOverride?: string | null;
    previousSha?: string | null;
    previousEtag?: string | null;
    onProgress?: (progress: { current: number; total: number }) => void;
  },
): Promise<{
  processed: number;
  updated: number;
  unchanged: number;
  skipped: number;
  versionLabel: string;
  ref: string;
  commitSha?: string;
  etag?: string;
  treeHash?: string;
}> {
  if (!source.owner || !source.repo) {
    throw new Error("Source is missing owner or repo");
  }

  const config = loadConfig();
  const force = options?.force ?? false;
  const concurrency = options?.concurrency ?? DEFAULT_INGEST_CONCURRENCY;
  const ingestMode = (source.ingest_mode ?? "docs").toLowerCase();
  const useDocsOnly = ingestMode !== "repo";
  const ref = options?.refOverride ?? source.ref ?? undefined;
  const result = await syncGithubRepo({
    config: {
      owner: source.owner,
      repo: source.repo,
      ref,
      basePath: source.docs_path ?? undefined,
      ext: useDocsOnly ? DOC_EXTENSIONS : undefined,
    },
    token: config.github?.token,
    previousSha: force ? null : (options?.previousSha ?? source.last_commit),
    previousEtag: force ? null : (options?.previousEtag ?? source.last_etag),
    force,
  });

  const versionLabel = options?.versionLabelOverride ?? source.version_label ?? ref ?? "HEAD";

  if (result.status === "not-modified") {
    return {
      processed: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      versionLabel,
      ref: ref ?? "HEAD",
      commitSha: result.commitSha,
      etag: result.etag,
    };
  }

  const prefix = buildPrefix(source.owner, source.repo, versionLabel);
  const fileResults: Array<{
    keepPath?: string;
    updated: number;
    unchanged: number;
    skippedNoCode: number;
  }> = new Array(result.files.length);
  const totalFiles = result.files.length;
  let currentFiles = 0;

  await runWithConcurrency(result.files, concurrency, async (file, index) => {
    const reportProgress = () => {
      currentFiles += 1;
      options?.onProgress?.({ current: currentFiles, total: totalFiles });
    };

    const isDoc = isDocFile(file.relPath);
    if (useDocsOnly || isDoc) {
      if (!containsCodeSnippet(file.content)) {
        fileResults[index] = { updated: 0, unchanged: 0, skippedNoCode: 1 };
        reportProgress();
        return;
      }
    }
    const title = extractTitle(file.content) ?? file.relPath.split("/").pop() ?? file.relPath;
    const uri = buildGithubUri(source.owner, source.repo, versionLabel, file.relPath);
    const contentType = isDoc ? "text/markdown" : "text/plain";

    const doc = upsertDocument(db, {
      sourceId: source.id,
      path: file.relPath,
      uri,
      title,
      hash: file.hash,
      contentType,
      versionLabel,
      content: file.content,
    });

    if (!doc.changed) {
      fileResults[index] = { keepPath: file.relPath, updated: 0, unchanged: 1, skippedNoCode: 0 };
      reportProgress();
      return;
    }

    deleteChunksForDocument(db, doc.id);
    const drafts = await buildDocumentChunks({
      content: file.content,
      filePath: file.relPath,
      title,
      prefix,
    });

    if (drafts.length === 0) {
      fileResults[index] = { updated: 0, unchanged: 0, skippedNoCode: 1 };
      reportProgress();
      return;
    }

    insertChunks(db, {
      documentId: doc.id,
      docPath: file.relPath,
      docUri: uri,
      docTitle: title,
      drafts,
    });

    fileResults[index] = { keepPath: file.relPath, updated: 1, unchanged: 0, skippedNoCode: 0 };
    reportProgress();
  });

  const keepPaths: string[] = [];
  let updated = 0;
  let unchanged = 0;
  let skippedNoCode = 0;
  for (const item of fileResults) {
    if (!item) continue;
    updated += item.updated;
    unchanged += item.unchanged;
    skippedNoCode += item.skippedNoCode;
    if (item.keepPath) keepPaths.push(item.keepPath);
  }

  deactivateMissingDocuments(db, {
    sourceId: source.id,
    versionLabel,
    keepPaths,
  });

  const treeHash = sha256Hex(result.tree);
  return {
    processed: result.processedFiles,
    updated,
    unchanged,
    skipped: result.skipped.length + skippedNoCode,
    versionLabel,
    ref: ref ?? "HEAD",
    commitSha: result.commitSha,
    etag: result.etag,
    treeHash,
  };
}

function extractTitle(content: string): string | null {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^#\s+(.*)$/);
    if (match?.[1]) return match[1].trim();
    if (line.trim()) break;
  }
  return null;
}

function buildGithubUri(owner: string, repo: string, ref: string, relPath: string): string {
  return `gh://${owner}/${repo}@${ref}/${relPath}`;
}

function buildPrefix(owner: string, repo: string, ref: string): string[] {
  const base = `${owner}/${repo}`;
  const segments = [base];
  if (ref && ref !== "HEAD") segments.push(ref);
  return segments;
}
