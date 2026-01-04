import { describe, expect, test } from "bun:test";
import { buildMarkdownChunks } from "../src/chunk/markdown";

describe("markdown chunker", () => {
  test("builds heading chunks with breadcrumb", async () => {
    const content = "# Title\n\n## Getting Started\nHello world\n\n## API\nMore details";
    const chunks = await buildMarkdownChunks({ content, documentTitle: "Title" });
    expect(chunks.length).toBeGreaterThan(0);
    const first = chunks[0];
    if (!first) throw new Error("Expected chunk");
    expect(first.chunkType).toBe("doc");
    expect(first.contextPath).toContain("Getting Started");
  });
});
