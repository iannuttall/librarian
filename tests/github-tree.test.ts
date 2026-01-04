import { describe, expect, test } from "bun:test";
import { buildRepoTree } from "../src/ingest/github/tree";

describe("github tree", () => {
  test("builds a tree string", () => {
    const tree = buildRepoTree([
      "README.md",
      "docs/intro.md",
      "docs/api/auth.md",
      "src/index.ts",
    ]);
    expect(tree).toContain("README.md");
    expect(tree).toContain("docs");
    expect(tree).toContain("api");
    expect(tree).toContain("index.ts");
  });
});
