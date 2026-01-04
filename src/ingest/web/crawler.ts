import { load } from "cheerio";
import { buildFetchOptions } from "./proxy";
import { extractFromHtml, bodyTrimmedLength } from "./extract";
import { sanitizeMarkdown, hasCodeSnippets, bodyLength } from "./sanitize";
import type { CrawlConfig, CrawlResult } from "./types";

const SPA_INDICATORS = [
  "__next_data__",
  "data-nextjs",
  "data-reactroot",
  "_react",
  "ng-app",
  "ng-version",
  "data-v-",
  "data-server-rendered",
  "app-root",
  '<div id="root"></div>',
  '<div id="app"></div>',
  '<div id="root">',
  '<div id="app">',
  "enable javascript",
  "requires javascript",
  "javascript is required",
  "javascript must be enabled",
];

export class WebsiteCrawler {
  private userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  ];

  constructor(
    private proxyEndpoint?: string,
    private headlessRenderer?: HeadlessRenderer,
  ) {}

  randomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)] ?? this.userAgents[0];
  }

  isLlmsManifest(url: string): boolean {
    try {
      const path = new URL(url).pathname;
      const basename = path.split("/").pop()?.toLowerCase() ?? "";
      return basename !== "" && /^llms.*\.txt$/.test(basename);
    } catch {
      return false;
    }
  }

  async fetchLlmsManifest(url: string, config: CrawlConfig): Promise<string[]> {
    const normalized = this.normalizeUrl(url);
    if (!normalized) throw new Error("Invalid URL");
    if (!this.inScope(normalized, config)) {
      throw new Error(`URL ${normalized} is outside the configured scope.`);
    }

    const opts = buildFetchOptions(this.proxyEndpoint, 15000);
    const response = await fetch(normalized, {
      ...opts,
      headers: {
        "User-Agent": this.randomUserAgent(),
        "Accept": "text/plain;q=1.0,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${normalized}: ${response.status}`);
    }

    const body = await response.text();
    const links: string[] = [];
    const lines = body.split(/\r?\n/);
    const base = new URL(normalized);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.includes("|")) continue;
      if (!trimmed.startsWith("-")) continue;

      let extractedUrl: string | null = null;
      const linkMatch = trimmed.match(/^-\s*\[.*?\]\((https?:\/\/[^\s)]+)\)/);
      if (linkMatch) {
        extractedUrl = linkMatch[1];
      } else {
        const clean = trimmed.replace(/^-\s*/, "");
        if (!/\s/.test(clean)) extractedUrl = clean;
      }

      if (!extractedUrl) continue;

      try {
        const resolved = new URL(extractedUrl, base);
        const normalizedLink = this.normalizeUrl(resolved.href);
        if (normalizedLink && normalizedLink.length <= 255 && this.inScope(normalizedLink, config)) {
          links.push(normalizedLink);
        }
      } catch {
        // Invalid URL
      }
    }

    return [...new Set(links)];
  }

  async fetch(url: string, config: CrawlConfig): Promise<CrawlResult> {
    const normalized = this.normalizeUrl(url);
    if (!normalized) throw new Error("Invalid URL");
    if (!this.inScope(normalized, config)) {
      throw new Error(`URL ${normalized} is outside the configured scope.`);
    }

    const userAgent = this.randomUserAgent();

    // Try markdown content negotiation first
    const markdownResult = await this.tryMarkdownContentNegotiation(normalized, userAgent, config);
    if (markdownResult) return markdownResult;

    // Fall back to HTML processing
    const opts = buildFetchOptions(this.proxyEndpoint, 20000);
    const response = await fetch(normalized, {
      ...opts,
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${normalized}: ${response.status}`);
    }

    let body = await response.text();
    let links = this.extractLinks(body, normalized, config);
    let extracted = extractFromHtml(body, normalized, { minBodyChars: config.minBodyCharacters });
    let markdown = sanitizeMarkdown(extracted.markdown);
    let length = bodyLength(markdown);

    // Check if headless rendering should be used
    const headlessCheck = this.shouldUseHeadless(body, markdown, links, config);

    if (headlessCheck.shouldUse && this.headlessRenderer) {
      const renderedHtml = await this.headlessRenderer.render(normalized, userAgent);
      if (renderedHtml) {
        body = renderedHtml;
        links = this.extractLinks(body, normalized, config);
        extracted = extractFromHtml(body, normalized, { minBodyChars: config.minBodyCharacters });
        markdown = sanitizeMarkdown(extracted.markdown);
        length = bodyLength(markdown);
      }
    }

    if (length < config.minBodyCharacters) {
      throw new Error("Document too small after sanitization.");
    }

    if (config.requireCodeSnippets && !hasCodeSnippets(markdown)) {
      throw new Error("Document missing code snippets.");
    }

    return {
      url: normalized,
      title: extracted.title,
      markdown,
      path: this.buildRelativePath(normalized, extracted.title),
      links,
    };
  }

  private async tryMarkdownContentNegotiation(
    url: string,
    userAgent: string,
    config: CrawlConfig,
  ): Promise<CrawlResult | null> {
    try {
      const opts = buildFetchOptions(this.proxyEndpoint, 20000);
      const response = await fetch(url, {
        ...opts,
        headers: {
          "User-Agent": userAgent,
          "Accept": "text/markdown;q=1.0,text/x-markdown;q=0.9,text/plain;q=0.5",
        },
      });

      if (!response.ok) return null;

      const contentType = response.headers.get("Content-Type") ?? "";
      const body = await response.text();

      const isMarkdown =
        contentType.includes("text/markdown") ||
        contentType.includes("text/x-markdown") ||
        (contentType.includes("text/plain") && this.looksLikeMarkdown(body));

      if (!isMarkdown) return null;

      return this.processMarkdownResponse(url, body, config);
    } catch {
      return null;
    }
  }

  private processMarkdownResponse(url: string, body: string, config: CrawlConfig): CrawlResult {
    const markdown = sanitizeMarkdown(body);
    const length = bodyLength(markdown);

    if (length < config.minBodyCharacters) {
      throw new Error("Document too small after sanitization.");
    }

    if (config.requireCodeSnippets && !hasCodeSnippets(markdown)) {
      throw new Error("Document missing code snippets.");
    }

    const title = this.extractTitleFromMarkdown(markdown, url);
    const links = this.extractLinksFromMarkdown(body, url, config);

    return {
      url,
      title,
      markdown,
      path: this.buildRelativePath(url, title),
      links,
    };
  }

  private extractLinksFromMarkdown(markdown: string, currentUrl: string, config: CrawlConfig): string[] {
    const links: string[] = [];
    const base = new URL(currentUrl);
    const matches = markdown.matchAll(/\[(?:[^\]]*)\]\(([^)\s]+)\)/g);

    for (const match of matches) {
      const href = match[1];
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        continue;
      }

      try {
        const resolved = new URL(href, base);
        const normalized = this.normalizeUrl(resolved.href);
        if (normalized && normalized.length <= 255 && this.inScope(normalized, config)) {
          links.push(normalized);
        }
      } catch {
        // Invalid URL
      }
    }

    return [...new Set(links)];
  }

  private shouldUseHeadless(
    html: string,
    markdown: string,
    links: string[],
    config: CrawlConfig,
  ): { shouldUse: boolean; reason: string } {
    if (config.forceHeadless) {
      return { shouldUse: true, reason: "force_headless enabled" };
    }

    if (!config.allowHeadless || !this.headlessRenderer?.isEnabled()) {
      return { shouldUse: false, reason: "headless disabled" };
    }

    const sparseThreshold = 400;
    const length = bodyLength(markdown);

    if (length < sparseThreshold) {
      return { shouldUse: true, reason: `body too short (${length} < ${sparseThreshold})` };
    }

    if (links.length < 3) {
      return { shouldUse: true, reason: `too few links extracted (${links.length})` };
    }

    const htmlLower = html.toLowerCase();
    for (const indicator of SPA_INDICATORS) {
      if (htmlLower.includes(indicator.toLowerCase())) {
        return { shouldUse: true, reason: `SPA indicator found: ${indicator}` };
      }
    }

    return { shouldUse: false, reason: "no signals detected" };
  }

  private extractTitleFromMarkdown(markdown: string, url: string): string {
    const h1Match = markdown.match(/^#\s+(.+)$/m);
    if (h1Match?.[1]) return h1Match[1].trim();

    try {
      const path = new URL(url).pathname;
      const filename = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
      return filename || new URL(url).host;
    } catch {
      return url;
    }
  }

  private looksLikeMarkdown(body: string): boolean {
    const trimmed = body.trimStart();
    if (!trimmed) return false;

    const prefix = trimmed.slice(0, 200).toLowerCase();
    if (prefix.includes("<!doctype") || prefix.includes("<html")) return false;

    return (
      /(^|\n)#{1,6}\s+\S/.test(body) ||
      body.includes("```") ||
      body.includes("~~~") ||
      /\[[^\]]+\]\([^)]+\)/.test(body) ||
      /(^|\n)\s*[-*+]\s+\S/.test(body)
    );
  }

  normalizeUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return null;

      const scheme = parsed.protocol.replace(":", "");
      const host = parsed.host.toLowerCase();
      let path = parsed.pathname.replace(/\/+/g, "/") || "/";

      // Strip .md extension
      if (path.toLowerCase().endsWith(".md")) {
        path = path.slice(0, -3);
      }

      let normalized = `${scheme}://${host}${path}`;
      if (parsed.search) {
        normalized += parsed.search;
      }

      return normalized.replace(/\/$/, "") || `${scheme}://${host}`;
    } catch {
      return null;
    }
  }

  inScope(url: string, config: CrawlConfig): boolean {
    try {
      const parsed = new URL(url);
      const rootParsed = new URL(config.rootUrl);

      const host = parsed.host.toLowerCase();
      const rootHost = rootParsed.host.toLowerCase();

      if (host !== rootHost) {
        if (!config.allowSubdomains) return false;
        if (!host.endsWith(`.${rootHost}`)) return false;
      }

      const path = parsed.pathname.toLowerCase();

      if (config.allowedPaths.length > 0) {
        const allowed = config.allowedPaths.some((p) => path.startsWith(p.toLowerCase()));
        if (!allowed) return false;
      }

      if (config.deniedPaths.length > 0) {
        const denied = config.deniedPaths.some((p) => path.startsWith(p.toLowerCase()));
        if (denied) return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  private extractLinks(html: string, currentUrl: string, config: CrawlConfig): string[] {
    const $ = load(html);
    const links: string[] = [];
    const base = new URL(currentUrl);

    $("a").each((_i, el) => {
      const href = $(el).attr("href");
      if (!href || href.startsWith("javascript:")) return;

      try {
        const resolved = new URL(href, base);
        const normalized = this.normalizeUrl(resolved.href);
        if (normalized && normalized.length <= 255 && this.inScope(normalized, config)) {
          links.push(normalized);
        }
      } catch {
        // Invalid URL
      }
    });

    return [...new Set(links)];
  }

  private buildRelativePath(url: string, title: string | null): string {
    try {
      const parsed = new URL(url);
      let path = parsed.pathname.replace(/^\//, "").replace(/\/$/, "");

      if (!path) {
        path = "index";
      }

      // Clean up path
      path = path.replace(/\.html?$/i, "").replace(/\.md$/i, "");

      // Add .md extension
      if (!path.endsWith(".md")) {
        path = `${path}.md`;
      }

      return path;
    } catch {
      return "page.md";
    }
  }
}

export type { HeadlessRenderer } from "./headless";
export { createHeadlessRenderer, findChromeBinaryPath, getChromeVersion, getInstallInstructions } from "./headless";
