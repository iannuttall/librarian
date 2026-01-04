import { describe, expect, test } from "bun:test";
import { discoverUrls } from "../src/ingest/web/sitemap";

describe("sitemap discovery", () => {
  test("discovers urls from hono.dev with llms.txt", async () => {
    const result = await discoverUrls("https://hono.dev/docs");

    expect(result.llmsTxtFound).toBe(true);
    expect(result.urls.length).toBeGreaterThan(0);

    // All URLs should be under hono.dev/docs
    for (const url of result.urls.slice(0, 10)) {
      expect(url).toContain("hono.dev");
    }
  }, 30000);

  test("filters urls by root path", async () => {
    const result = await discoverUrls("https://hono.dev/docs/guides");

    // Should only include URLs under /docs/guides
    for (const url of result.urls) {
      const parsed = new URL(url);
      expect(parsed.pathname.startsWith("/docs/guides")).toBe(true);
    }
  }, 30000);
});
