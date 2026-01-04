import { describe, expect, test } from "bun:test";
import { buildCodeChunkDrafts } from "../src/chunk/code";

describe("code chunker", () => {
  test("chunks code with breadcrumb", async () => {
    const code =
      "export function hello(name: string) {\n" +
      "  return `hi ${name}`;\n" +
      "}\n\n" +
      "export class User {\n" +
      "  constructor(public id: string) {}\n" +
      "}";
    const chunks = await buildCodeChunkDrafts({
      content: code,
      filePath: "src/user.ts",
      language: "ts",
      prefix: [],
    });
    expect(chunks.length).toBeGreaterThan(0);
    const first = chunks[0];
    if (!first) throw new Error("Expected chunk");
    expect(first.chunkType).toBe("code");
    expect(first.contextPath).toContain("src/user.ts");
    expect(first.content).toContain("```");
  });
});
