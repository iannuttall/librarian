import { describe, expect, test } from "bun:test";
import { fuseRankedLists, type SearchHit } from "../src/search/hybrid";

describe("search hybrid", () => {
  test("fuses ranked lists with weights", () => {
    const base: SearchHit = {
      chunkId: 1,
      docId: 1,
      score: 1,
      source: "fts",
      title: "Doc",
      path: "doc.md",
      uri: "uri",
      contextPath: null,
      lineStart: null,
      lineEnd: null,
      preview: null,
      content: "content",
    };
    const listA = [{ ...base, chunkId: 1 }, { ...base, chunkId: 2 }];
    const listB = [{ ...base, chunkId: 2 }, { ...base, chunkId: 3 }];

    const fused = fuseRankedLists([listA, listB], [2, 1], 3);
    expect(fused.length).toBe(3);
    const first = fused[0];
    if (!first) throw new Error("Expected result");
    expect(first.chunkId).toBe(2);
  });
});
