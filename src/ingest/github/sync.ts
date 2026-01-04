import { downloadArchive, type RepoRef } from "./download";
import { cleanupTemp, extractToTemp, listFiles } from "./extract";
import { filterAndLoadFiles, type FilterOptions } from "./filter";
import { buildRepoTree } from "./tree";
import type { LoadedFile, SkippedFile } from "./types";

export type GithubSourceConfig = {
  owner: string;
  repo: string;
  ref?: string;
  basePath?: string;
  ext?: string[];
  include?: string[];
  exclude?: string[];
};

export type GithubSyncInput = {
  config: GithubSourceConfig;
  token?: string;
  previousSha?: string | null;
  previousEtag?: string | null;
  force?: boolean;
  filter?: FilterOptions;
  maxArchiveBytes?: number;
  onFile?: (file: LoadedFile) => Promise<void> | void;
};

export type GithubSyncResult =
  | {
      status: "not-modified";
      commitSha?: string;
      etag?: string;
      lastModified?: string;
      processedFiles?: number;
    }
  | {
      status: "ok";
      commitSha: string;
      etag?: string;
      lastModified?: string;
      tree: string;
      files: LoadedFile[];
      skipped: SkippedFile[];
      processedFiles: number;
    };

export async function syncGithubRepo(input: GithubSyncInput): Promise<GithubSyncResult> {
  const ref: RepoRef = {
    owner: input.config.owner,
    repo: input.config.repo,
    ref: input.config.ref,
  };

  let extractDir: string | null = null;

  try {
    const download = await downloadArchive(ref, {
      token: input.token,
      etag: input.previousEtag ?? undefined,
      maxBytes: input.maxArchiveBytes,
    });

    if (download.status === "not-modified") {
      return {
        status: "not-modified",
        commitSha: input.previousSha ?? undefined,
        etag: download.etag,
        processedFiles: 0,
      };
    }

    const extracted = await extractToTemp(download.zip);
    extractDir = extracted.tempDir;

    const commitSha = resolveCommitSha({
      headerSha: download.sha,
      url: download.url,
      topLevelDir: extracted.topLevelDir,
      previous: input.previousSha,
    });
    if (commitSha && input.previousSha && commitSha === input.previousSha && !input.force) {
      return { status: "not-modified", commitSha, etag: download.etag };
    }

    const files = await listFiles(extracted.tempDir, input.config.basePath);
    const streamedPaths: string[] = [];
    let collected: LoadedFile[] = [];

    const { loaded, skipped } = await filterAndLoadFiles(
      files,
      {
        extensions: input.config.ext,
        include: input.config.include,
        exclude: input.config.exclude,
        maxFileBytes: input.filter?.maxFileBytes,
      },
      input.onFile
        ? async (file) => {
            streamedPaths.push(file.relPath);
            await input.onFile?.(file);
          }
        : undefined,
    );

    if (!input.onFile) {
      collected = loaded;
      for (const file of loaded) {
        streamedPaths.push(file.relPath);
      }
    }

    const tree = buildRepoTree([
      ...streamedPaths,
      ...skipped.map((skip) => skip.relPath),
    ]);

    return {
      status: "ok",
      commitSha: commitSha ?? "unknown",
      etag: download.etag,
      lastModified: download.lastModified,
      tree,
      files: collected,
      skipped,
      processedFiles: streamedPaths.length,
    };
  } finally {
    if (extractDir) await cleanupTemp(extractDir);
  }
}

function resolveCommitSha(input: {
  headerSha?: string;
  url: string;
  topLevelDir?: string;
  previous?: string | null;
}): string | undefined {
  if (input.headerSha && /^[0-9a-f]{7,40}$/i.test(input.headerSha)) return input.headerSha;
  const fromDir = parseShaFromTopLevel(input.topLevelDir);
  if (fromDir) return fromDir;
  const fromUrl = parseShaFromUrl(input.url);
  if (fromUrl) return fromUrl;
  return input.previous ?? undefined;
}

function parseShaFromTopLevel(topLevel?: string): string | undefined {
  if (!topLevel) return undefined;
  const parts = topLevel.split("-");
  const maybe = parts[parts.length - 1];
  if (maybe && /^[0-9a-f]{7,40}$/i.test(maybe)) return maybe;
  return undefined;
}

function parseShaFromUrl(url: string): string | undefined {
  const tail = url.split("/").pop() ?? "";
  const trimmed = tail.replace(/\.zip$/i, "");
  if (trimmed && /^[0-9a-f]{7,40}$/i.test(trimmed)) return trimmed;
  return undefined;
}
