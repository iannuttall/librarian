export type GithubUrlParts = {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
};

export function parseGithubUrl(url: string): GithubUrlParts | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repoPart = parts[1];
    if (!owner || !repoPart) return null;
    const repo = repoPart.replace(/\.git$/, "");

    if (parts[2] === "tree" || parts[2] === "blob") {
      const ref = parts[3];
      const pathParts = parts.slice(4);
      return { owner, repo, ref, path: pathParts.join("/") };
    }

    return { owner, repo };
  } catch {
    return null;
  }
}

export function normalizeDocsPath(pathValue: string | null): string | null {
  if (!pathValue) return null;
  const trimmed = pathValue.trim().replace(/^\//, "").replace(/\/$/, "");
  return trimmed || null;
}
