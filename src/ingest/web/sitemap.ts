import { buildFetchOptions } from "./proxy";

const MAX_SITEMAP_DEPTH = 3;
const SITEMAP_TIMEOUT = 30000;

export interface DiscoveryResult {
  urls: string[];
  llmsTxtFound: boolean;
  sitemapFound: boolean;
}

export async function discoverUrls(
  rootUrl: string,
  proxyEndpoint?: string,
  userAgent?: string,
): Promise<DiscoveryResult> {
  const parsed = new URL(rootUrl);
  const scheme = parsed.protocol.replace(":", "");
  const host = parsed.host;
  const rootPath = parsed.pathname.replace(/\/$/, "");
  const domain = `${scheme}://${host}`;
  const root = rootPath ? `${domain}${rootPath}` : domain;

  const allUrls: string[] = [];
  let llmsTxtFound = false;
  let sitemapFound = false;

  // Check llms.txt first
  const llmsUrls = await discoverFromLlmsTxt(root, domain, proxyEndpoint, userAgent);
  if (llmsUrls.length > 0) {
    llmsTxtFound = true;
    allUrls.push(...llmsUrls);
  }

  // Check sitemaps
  const sitemapUrls = await discoverSitemapUrls(root, domain, proxyEndpoint, userAgent);
  for (const sitemapUrl of sitemapUrls) {
    const urls = await parseSitemap(sitemapUrl, 0, proxyEndpoint, userAgent);
    if (urls.length > 0) sitemapFound = true;
    allUrls.push(...urls);
  }

  // Filter to only URLs matching the root path
  const filtered = filterByPath(allUrls, host, rootPath);

  return {
    urls: [...new Set(filtered)],
    llmsTxtFound,
    sitemapFound,
  };
}

async function discoverFromLlmsTxt(
  root: string,
  domain: string,
  proxyEndpoint?: string,
  userAgent?: string,
): Promise<string[]> {
  const llmsTxtUrls = [
    `${root.replace(/\/$/, "")}/llms.txt`,
    `${root.replace(/\/$/, "")}/llms-full.txt`,
    `${domain.replace(/\/$/, "")}/llms.txt`,
    `${domain.replace(/\/$/, "")}/llms-full.txt`,
  ];

  const unique = [...new Set(llmsTxtUrls)];

  for (const url of unique) {
    const urls = await parseLlmsTxt(url, proxyEndpoint, userAgent);
    if (urls.length > 0) return urls;
  }

  return [];
}

async function parseLlmsTxt(
  url: string,
  proxyEndpoint?: string,
  userAgent?: string,
): Promise<string[]> {
  try {
    const opts = buildFetchOptions(proxyEndpoint, SITEMAP_TIMEOUT);
    const response = await fetch(url, {
      ...opts,
      headers: {
        "User-Agent": userAgent ?? getDefaultUserAgent(),
        "Accept": "text/plain,*/*",
      },
    });

    if (!response.ok) return [];

    const content = await response.text();
    const urls: string[] = [];
    const lines = content.split(/\r?\n/);
    const base = new URL(url);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Skip table rows
      if (trimmed.includes("|")) continue;

      // Only process list items
      if (!trimmed.startsWith("-")) continue;

      let extractedUrl: string | null = null;

      // Extract markdown link: - [Title](URL)
      const linkMatch = trimmed.match(/^-\s*\[.*?\]\((https?:\/\/[^\s)]+)\)/);
      if (linkMatch) {
        extractedUrl = linkMatch[1];
      } else {
        // Bare URL
        const clean = trimmed.replace(/^-\s*/, "");
        if (!/\s/.test(clean) && (clean.startsWith("http://") || clean.startsWith("https://"))) {
          extractedUrl = clean;
        }
      }

      if (extractedUrl) {
        try {
          const resolved = new URL(extractedUrl, base);
          if (resolved.href.length <= 255) {
            urls.push(resolved.href);
          }
        } catch {
          // Invalid URL
        }
      }
    }

    return urls;
  } catch {
    return [];
  }
}

async function discoverSitemapUrls(
  root: string,
  domain: string,
  proxyEndpoint?: string,
  userAgent?: string,
): Promise<string[]> {
  const sitemaps: string[] = [];

  // Check root/robots.txt
  const rootRobots = `${root.replace(/\/$/, "")}/robots.txt`;
  sitemaps.push(...await parseSitemapsFromRobots(rootRobots, proxyEndpoint, userAgent));

  // Check root/sitemap.xml
  const rootSitemap = `${root.replace(/\/$/, "")}/sitemap.xml`;
  if (await sitemapExists(rootSitemap, proxyEndpoint, userAgent)) {
    sitemaps.push(rootSitemap);
  }

  // If root != domain, check domain level
  if (root.replace(/\/$/, "") !== domain.replace(/\/$/, "")) {
    const domainRobots = `${domain.replace(/\/$/, "")}/robots.txt`;
    sitemaps.push(...await parseSitemapsFromRobots(domainRobots, proxyEndpoint, userAgent));

    const domainSitemap = `${domain.replace(/\/$/, "")}/sitemap.xml`;
    if (await sitemapExists(domainSitemap, proxyEndpoint, userAgent)) {
      sitemaps.push(domainSitemap);
    }
  }

  return [...new Set(sitemaps)];
}

async function parseSitemapsFromRobots(
  robotsUrl: string,
  proxyEndpoint?: string,
  userAgent?: string,
): Promise<string[]> {
  try {
    const opts = buildFetchOptions(proxyEndpoint, SITEMAP_TIMEOUT);
    const response = await fetch(robotsUrl, {
      ...opts,
      headers: {
        "User-Agent": userAgent ?? getDefaultUserAgent(),
      },
    });

    if (!response.ok) return [];

    const content = await response.text();
    const sitemaps: string[] = [];
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.startsWith("sitemap:")) {
        let url = line.trim().slice(8).trim();

        if (url.startsWith("//")) {
          url = `https:${url}`;
        } else if (url.startsWith("/")) {
          const parsed = new URL(robotsUrl);
          url = `${parsed.protocol}//${parsed.host}${url}`;
        } else if (!url.startsWith("http")) {
          url = `https://${url.replace(/^\/+/, "")}`;
        }

        try {
          new URL(url);
          sitemaps.push(url);
        } catch {
          // Invalid URL
        }
      }
    }

    return sitemaps;
  } catch {
    return [];
  }
}

async function sitemapExists(
  url: string,
  proxyEndpoint?: string,
  userAgent?: string,
): Promise<boolean> {
  try {
    const opts = buildFetchOptions(proxyEndpoint, SITEMAP_TIMEOUT);
    const response = await fetch(url, {
      ...opts,
      headers: {
        "User-Agent": userAgent ?? getDefaultUserAgent(),
        "Accept": "application/xml,text/xml,*/*",
      },
    });

    if (!response.ok) return false;

    const content = await response.text();
    return content.includes("<urlset") || content.includes("<sitemapindex");
  } catch {
    return false;
  }
}

async function parseSitemap(
  url: string,
  depth: number,
  proxyEndpoint?: string,
  userAgent?: string,
): Promise<string[]> {
  if (depth > MAX_SITEMAP_DEPTH) return [];

  try {
    const opts = buildFetchOptions(proxyEndpoint, SITEMAP_TIMEOUT);
    const response = await fetch(url, {
      ...opts,
      headers: {
        "User-Agent": userAgent ?? getDefaultUserAgent(),
        "Accept": "application/xml,text/xml,*/*",
      },
    });

    if (!response.ok) return [];

    const content = await response.text();

    // Sitemap index
    if (content.includes("<sitemapindex")) {
      return parseSitemapIndex(content, depth, proxyEndpoint, userAgent);
    }

    // Regular sitemap
    return extractUrlsFromSitemap(content);
  } catch {
    return [];
  }
}

async function parseSitemapIndex(
  content: string,
  depth: number,
  proxyEndpoint?: string,
  userAgent?: string,
): Promise<string[]> {
  const locMatches = content.match(/<loc>([^<]+)<\/loc>/gi) ?? [];
  const sitemapUrls = locMatches.map((m) => {
    const match = m.match(/<loc>([^<]+)<\/loc>/i);
    return match?.[1] ? decodeHtmlEntities(match[1].trim()) : "";
  }).filter(Boolean);

  const allUrls: string[] = [];
  for (const childUrl of sitemapUrls) {
    try {
      new URL(childUrl);
      const urls = await parseSitemap(childUrl, depth + 1, proxyEndpoint, userAgent);
      allUrls.push(...urls);
    } catch {
      // Invalid URL
    }
  }

  return allUrls;
}

function extractUrlsFromSitemap(content: string): string[] {
  const locMatches = content.match(/<loc>([^<]+)<\/loc>/gi) ?? [];
  return locMatches.map((m) => {
    const match = m.match(/<loc>([^<]+)<\/loc>/i);
    return match?.[1] ? decodeHtmlEntities(match[1].trim()) : "";
  }).filter((url) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  });
}

function filterByPath(urls: string[], host: string, rootPath: string): string[] {
  const hostLower = host.toLowerCase();
  const rootPathLower = rootPath.toLowerCase();

  return urls.filter((url) => {
    try {
      const parsed = new URL(url);
      if (parsed.host.toLowerCase() !== hostLower) return false;
      if (rootPath && !parsed.pathname.toLowerCase().startsWith(rootPathLower)) return false;
      return true;
    } catch {
      return false;
    }
  });
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getDefaultUserAgent(): string {
  return "Mozilla/5.0 (compatible; Librarian/1.0; +https://github.com/librarian)";
}
