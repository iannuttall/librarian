import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createHeadlessRenderer, findChromeBinaryPath, getChromeVersion } from "../src/ingest/web/headless";
import { WebsiteCrawler } from "../src/ingest/web/crawler";
import { createDefaultCrawlConfig } from "../src/ingest/web/types";
import type { HeadlessRenderer } from "../src/ingest/web/headless";

// Skip headless tests by default (they open Chrome windows on macOS)
// Run with: HEADLESS_TESTS=1 bun test tests/web-headless.test.ts
const SKIP_HEADLESS = process.env.HEADLESS_TESTS !== "1";
const describeHeadless = SKIP_HEADLESS ? describe.skip : describe;

describeHeadless("headless chrome", () => {
  test("finds chrome binary", () => {
    const chromePath = findChromeBinaryPath();

    // This test may fail on systems without Chrome installed
    if (chromePath) {
      console.log(`Chrome found at: ${chromePath}`);
      expect(chromePath.length).toBeGreaterThan(0);
    } else {
      console.log("Chrome not found - skipping chrome-dependent tests");
    }
  });

  test("gets chrome version", () => {
    const chromePath = findChromeBinaryPath();
    if (!chromePath) {
      console.log("Chrome not found - skipping");
      return;
    }

    const version = getChromeVersion(chromePath);
    console.log(`Chrome version: ${version}`);

    if (version) {
      expect(version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    }
  });

  test("creates headless renderer", async () => {
    const chromePath = findChromeBinaryPath();
    if (!chromePath) {
      console.log("Chrome not found - skipping");
      return;
    }

    const renderer = await createHeadlessRenderer({
      enabled: true,
      chromePath,
    });

    expect(renderer).not.toBe(null);
    expect(renderer?.isEnabled()).toBe(true);
    expect(renderer?.isAvailable()).toBe(true);

    await renderer?.close();
  });
});

describeHeadless("csr site rendering", () => {
  let renderer: HeadlessRenderer | null = null;

  beforeAll(async () => {
    const chromePath = findChromeBinaryPath();
    if (chromePath) {
      renderer = await createHeadlessRenderer({
        enabled: true,
        chromePath,
        timeout: 60000,
      });
    }
  });

  afterAll(async () => {
    if (renderer) {
      await renderer.close();
    }
  });

  test("renders CSR documentation site", async () => {
    if (!renderer) {
      console.log("Chrome not available - skipping CSR test");
      return;
    }

    // This is a client-side rendered Swift docs site
    const url = "https://nonstrict.eu/recordkit/api/swift/documentation/recordkit/";

    console.log(`Rendering CSR site: ${url}`);
    const html = await renderer.render(url);

    expect(html).not.toBe(null);
    if (!html) {
      throw new Error("Expected HTML output");
    }
    expect(html.length).toBeGreaterThan(1000);

    // Check that content was actually rendered (not just shell)
    // CSR sites typically have minimal HTML until JS runs
    expect(html).toContain("RecordKit");

    console.log(`Rendered HTML length: ${html.length}`);
  }, 90000);

  test("crawler falls back to headless for sparse content", async () => {
    if (!renderer) {
      console.log("Chrome not available - skipping fallback test");
      return;
    }

    const crawler = new WebsiteCrawler(undefined, renderer);
    const config = {
      ...createDefaultCrawlConfig("https://nonstrict.eu/recordkit"),
      allowedPaths: ["/recordkit"],
      requireCodeSnippets: false, // Allow docs without code
      minBodyCharacters: 100,
    };

    console.log("Fetching CSR page through crawler...");
    const result = await crawler.fetch(
      "https://nonstrict.eu/recordkit/api/swift/documentation/recordkit/",
      config
    );

    expect(result.url).toContain("nonstrict.eu");
    expect(result.markdown.length).toBeGreaterThan(100);
    expect(result.title).toBeTruthy();

    console.log(`Title: ${result.title}`);
    console.log(`Markdown length: ${result.markdown.length}`);
    console.log(`Links found: ${result.links.length}`);

    // Should have actual content, not just empty shell
    expect(result.markdown).toContain("RecordKit");
  }, 90000);
});
