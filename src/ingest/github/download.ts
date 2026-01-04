import { setTimeout as delay } from "node:timers/promises";

export type RepoRef = { owner: string; repo: string; ref?: string };

export type DownloadArchiveOpts = {
  token?: string;
  etag?: string;
  timeoutMs?: number;
  maxBytes?: number;
};

export type DownloadOutcome =
  | {
      status: "ok";
      zip: Uint8Array;
      url: string;
      sha?: string;
      etag?: string;
      lastModified?: string;
    }
  | { status: "not-modified"; etag?: string };

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;

export async function downloadArchive(
  ref: RepoRef,
  opts: DownloadArchiveOpts = {},
): Promise<DownloadOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const urls = buildZipballUrls(ref);

  let lastError: unknown;
  for (const url of urls) {
    try {
      const res = await fetchWithGuards(url, {
        token: opts.token,
        timeoutMs,
        maxBytes,
        etag: opts.etag,
      });
      if (res.status === "not-modified") return res;
      return res;
    } catch (err) {
      lastError = err;
      await delay(150);
    }
  }
  throw new Error(
    `failed to download GitHub archive: ${String(
      (lastError as Error)?.message ?? lastError,
    )}`,
  );
}

function buildZipballUrls(ref: RepoRef): string[] {
  const apiBase = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const webBase = `https://github.com/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/archive`;
  const target = ref.ref ? encodeURIComponent(ref.ref) : "HEAD";
  const urls: string[] = [];
  urls.push(`${apiBase}/zipball/${target}`);

  if (!ref.ref) {
    urls.push(`${webBase}/HEAD.zip`);
    return urls;
  }

  const isSha = /^[0-9a-f]{4,40}$/i.test(ref.ref);
  if (isSha) {
    urls.push(`${webBase}/${encodeURIComponent(ref.ref)}.zip`);
  }
  const refPath = encodeURI(ref.ref);
  urls.push(`${webBase}/refs/heads/${refPath}.zip`);
  urls.push(`${webBase}/refs/tags/${refPath}.zip`);
  return urls;
}

async function fetchWithGuards(
  url: string,
  opts: { token?: string; timeoutMs: number; maxBytes: number; etag?: string },
): Promise<DownloadOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const headers: Record<string, string> = {
      "User-Agent": "librarian",
      Accept: "application/vnd.github+json",
    };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.etag) headers["If-None-Match"] = opts.etag;

    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers,
    });

    if (res.status === 304) {
      return { status: "not-modified", etag: opts.etag };
    }

    if (res.status === 401) throw new Error("GitHub token invalid or expired");
    if (res.status === 403) {
      throw new Error(
        opts.token
          ? "GitHub denied access. Token may lack repo contents scope or hit rate limits."
          : "GitHub denied access or rate limited the request. Provide a token for private repos.",
      );
    }
    if (res.status === 404) throw new Error("Repository or reference not found");
    if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
      throw new Error(`GitHub ${res.status}: retryable response`);
    }
    if (!res.ok || !res.body) throw new Error(`GitHub error ${res.status} ${res.statusText}`);

    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > opts.maxBytes) {
      throw new Error(
        `Archive is ${formatMb(Number(contentLength))}, exceeds ${formatMb(opts.maxBytes)} limit`,
      );
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        loaded += value.byteLength;
        if (loaded > opts.maxBytes) {
          throw new Error(
            `Archive exceeded ${formatMb(opts.maxBytes)} limit (${formatMb(loaded)} received)`,
          );
        }
        chunks.push(value);
      }
    }
    const zip = concatChunks(chunks, loaded);
    const sha = res.headers.get("x-github-sha") ?? undefined;
    const etag = normalizeEtag(res.headers.get("etag"));
    const lastModified = res.headers.get("last-modified") ?? undefined;
    return {
      status: "ok",
      zip,
      url: res.url,
      sha: sha || undefined,
      etag,
      lastModified,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) {
    const [first] = chunks;
    return first ? first : new Uint8Array(0);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buf;
}

function normalizeEtag(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^W\//, "");
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
