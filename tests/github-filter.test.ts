import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { filterAndLoadFiles } from "../src/ingest/github/filter";
import type { ExtractedFile } from "../src/ingest/github/types";

describe("github filter", () => {
  test("skips non-text files", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-test-"));
    const mdPath = join(dir, "README.md");
    const pngPath = join(dir, "logo.png");
    writeFileSync(mdPath, "# Hello");
    writeFileSync(pngPath, "fake");

    const files: ExtractedFile[] = [
      { absPath: mdPath, relPath: "README.md" },
      { absPath: pngPath, relPath: "logo.png" },
    ];

    const { loaded } = await filterAndLoadFiles(files);
    expect(loaded.length).toBe(1);
    const first = loaded[0];
    if (!first) throw new Error("Expected file");
    expect(first.relPath).toBe("README.md");
  });

  test("keeps special file names", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-test-"));
    const dockerfile = join(dir, "Dockerfile");
    writeFileSync(dockerfile, "FROM node:20");

    const files: ExtractedFile[] = [{ absPath: dockerfile, relPath: "Dockerfile" }];
    const { loaded } = await filterAndLoadFiles(files);
    expect(loaded.length).toBe(1);
    const first = loaded[0];
    if (!first) throw new Error("Expected file");
    expect(first.relPath).toBe("Dockerfile");
  });

  test("skips hidden and minified files", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-test-"));
    const hidden = join(dir, ".env");
    const minified = join(dir, "bundle.min.js");
    writeFileSync(hidden, "SECRET=1");
    writeFileSync(minified, "minified");

    const files: ExtractedFile[] = [
      { absPath: hidden, relPath: ".env" },
      { absPath: minified, relPath: "bundle.min.js" },
    ];
    const { loaded } = await filterAndLoadFiles(files);
    expect(loaded.length).toBe(0);
  });

  test("skips files over size limit", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-test-"));
    const big = join(dir, "README.md");
    writeFileSync(big, "0123456789");
    const files: ExtractedFile[] = [{ absPath: big, relPath: "README.md" }];
    const { loaded } = await filterAndLoadFiles(files, { maxFileBytes: 5 });
    expect(loaded.length).toBe(0);
  });
});
