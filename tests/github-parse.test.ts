import { describe, expect, test } from "bun:test";
import { parseGithubUrl, normalizeDocsPath } from "../src/ingest/github/parse";

describe("github url parse", () => {
  test("parses basic repo url", () => {
    const parsed = parseGithubUrl("https://github.com/foo/bar");
    expect(parsed?.owner).toBe("foo");
    expect(parsed?.repo).toBe("bar");
  });

  test("parses tree url with path", () => {
    const parsed = parseGithubUrl("https://github.com/foo/bar/tree/main/docs");
    expect(parsed?.ref).toBe("main");
    expect(parsed?.path).toBe("docs");
  });

  test("normalizes docs path", () => {
    expect(normalizeDocsPath("/docs/")).toBe("docs");
  });
});
