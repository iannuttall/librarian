type GithubRepoInfo = {
  owner: string;
  repo: string;
  defaultBranch: string;
};

type GithubTag = {
  name: string;
  publishedAt?: string | null;
};

type GithubBranch = {
  name: string;
  protected?: boolean;
};

type GithubRepoListing = {
  fullName: string;
  owner: string;
  repo: string;
  private: boolean;
};

export async function fetchRepoInfo(owner: string, repo: string, token?: string): Promise<GithubRepoInfo | null> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const res = await githubRequest(url, token);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    owner: data.owner?.login ?? owner,
    repo: data.name ?? repo,
    defaultBranch: data.default_branch ?? "main",
  };
}

export async function fetchRepoInfoWithStatus(
  owner: string,
  repo: string,
  token?: string,
): Promise<{ info: { owner: string; repo: string; defaultBranch: string } | null; status: number; rateLimited: boolean }> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const res = await githubRequest(url, token);
  const remaining = res.headers.get("x-ratelimit-remaining");
  const rateLimited = res.status === 403 && remaining === "0";
  if (!res.ok) return { info: null, status: res.status, rateLimited };
  const data = await res.json();
  return {
    info: {
      owner: data.owner?.login ?? owner,
      repo: data.name ?? repo,
      defaultBranch: data.default_branch ?? "main",
    },
    status: res.status,
    rateLimited: false,
  };
}

export async function fetchBranches(owner: string, repo: string, token?: string): Promise<GithubBranch[]> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`;
  const res = await githubRequest(url, token);
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((branch) => ({
    name: branch?.name ?? "",
    protected: Boolean(branch?.protected),
  })).filter((b) => b.name);
}

export async function fetchStableTags(owner: string, repo: string, token?: string): Promise<GithubTag[]> {
  const releasesUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=100`;
  const releasesRes = await githubRequest(releasesUrl, token);
  if (releasesRes.ok) {
    const releases = await releasesRes.json();
    if (Array.isArray(releases)) {
      const stable = releases
        .filter((r) => !r?.prerelease && !r?.draft)
        .slice(0, 30)
        .map((r) => ({
          name: String(r?.tag_name ?? "").trim(),
          publishedAt: r?.published_at ?? null,
        }))
        .filter((t) => t.name && !isPrereleaseTag(t.name));
      if (stable.length > 0) return stable;
    }
  }

  const tagsUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags?per_page=100`;
  const tagsRes = await githubRequest(tagsUrl, token);
  if (!tagsRes.ok) return [];
  const tags = await tagsRes.json();
  if (!Array.isArray(tags)) return [];
  return tags
    .slice(0, 30)
    .map((t) => ({ name: String(t?.name ?? "").trim(), publishedAt: null }))
    .filter((t) => t.name && !isPrereleaseTag(t.name));
}

export async function fetchRepos(token?: string): Promise<GithubRepoListing[]> {
  if (!token) return [];
  const url = "https://api.github.com/user/repos?per_page=100&sort=updated";
  const res = await githubRequest(url, token);
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((repo) => ({
    fullName: String(repo?.full_name ?? "").trim(),
    owner: String(repo?.owner?.login ?? "").trim(),
    repo: String(repo?.name ?? "").trim(),
    private: Boolean(repo?.private),
  })).filter((r) => r.fullName && r.owner && r.repo);
}

function isPrereleaseTag(tag: string): boolean {
  const lower = tag.toLowerCase();
  const patterns = [
    "-alpha",
    "-beta",
    "-rc",
    "-canary",
    "-dev",
    "-nightly",
    "-preview",
    "-pre",
    "-next",
    "-snapshot",
    "-unstable",
  ];
  if (patterns.some((pattern) => lower.includes(pattern))) return true;
  const exact = ["canary", "next", "nightly", "latest", "dev", "master", "main"];
  return exact.includes(lower);
}

async function githubRequest(url: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "librarian",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { headers });
}
