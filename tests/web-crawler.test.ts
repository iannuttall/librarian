import { describe, expect, test } from "bun:test";
import { WebsiteCrawler } from "../src/ingest/web/crawler";
import { createDefaultCrawlConfig } from "../src/ingest/web/types";

describe("website crawler", () => {
  test("normalizes urls correctly", () => {
    const crawler = new WebsiteCrawler();

    // Basic normalization
    expect(crawler.normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(crawler.normalizeUrl("https://example.com")).toBe("https://example.com");
    expect(crawler.normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");

    // Strips .md extension
    expect(crawler.normalizeUrl("https://example.com/docs/readme.md")).toBe("https://example.com/docs/readme");

    // Preserves query string
    expect(crawler.normalizeUrl("https://example.com/search?q=test")).toBe("https://example.com/search?q=test");

    // Lowercases host
    expect(crawler.normalizeUrl("https://Example.COM/Path")).toBe("https://example.com/Path");

    // Rejects non-http schemes
    expect(crawler.normalizeUrl("ftp://example.com")).toBe(null);
    expect(crawler.normalizeUrl("javascript:void(0)")).toBe(null);
  });

  test("checks url scope correctly", () => {
    const crawler = new WebsiteCrawler();
    const config = createDefaultCrawlConfig("https://example.com/docs");

    // In scope
    expect(crawler.inScope("https://example.com/docs", config)).toBe(true);
    expect(crawler.inScope("https://example.com/docs/guide", config)).toBe(true);
    expect(crawler.inScope("https://example.com/docs/api/reference", config)).toBe(true);

    // Out of scope - different path
    expect(crawler.inScope("https://example.com/blog", config)).toBe(false);
    expect(crawler.inScope("https://example.com/", config)).toBe(false);

    // Out of scope - different host
    expect(crawler.inScope("https://other.com/docs", config)).toBe(false);
  });

  test("respects allowed and denied paths", () => {
    const crawler = new WebsiteCrawler();
    const config = {
      ...createDefaultCrawlConfig("https://example.com"),
      allowedPaths: ["/docs", "/api"],
      deniedPaths: ["/docs/internal"],
    };

    expect(crawler.inScope("https://example.com/docs/guide", config)).toBe(true);
    expect(crawler.inScope("https://example.com/api/reference", config)).toBe(true);
    expect(crawler.inScope("https://example.com/blog", config)).toBe(false);
    expect(crawler.inScope("https://example.com/docs/internal/secret", config)).toBe(false);
  });

  test("handles subdomains correctly", () => {
    const crawler = new WebsiteCrawler();

    const noSubdomains = {
      ...createDefaultCrawlConfig("https://example.com"),
      allowSubdomains: false,
    };

    const withSubdomains = {
      ...createDefaultCrawlConfig("https://example.com"),
      allowSubdomains: true,
    };

    expect(crawler.inScope("https://docs.example.com/", noSubdomains)).toBe(false);
    expect(crawler.inScope("https://docs.example.com/", withSubdomains)).toBe(true);
    expect(crawler.inScope("https://api.example.com/v1", withSubdomains)).toBe(true);
  });

  test("detects llms.txt manifest files", () => {
    const crawler = new WebsiteCrawler();

    expect(crawler.isLlmsManifest("https://example.com/llms.txt")).toBe(true);
    expect(crawler.isLlmsManifest("https://example.com/llms-full.txt")).toBe(true);
    expect(crawler.isLlmsManifest("https://example.com/docs/llms.txt")).toBe(true);

    expect(crawler.isLlmsManifest("https://example.com/docs")).toBe(false);
    expect(crawler.isLlmsManifest("https://example.com/readme.txt")).toBe(false);
  });

  test("fetches page from hono.dev", async () => {
    const crawler = new WebsiteCrawler();
    const config = createDefaultCrawlConfig("https://hono.dev/docs");

    const result = await crawler.fetch("https://hono.dev/docs/getting-started/basic", config);

    expect(result.url).toContain("hono.dev");
    expect(result.title).toBeTruthy();
    expect(result.markdown.length).toBeGreaterThan(100);
    expect(result.path).toContain(".md");
    expect(result.links.length).toBeGreaterThan(0);
  }, 30000);
});
