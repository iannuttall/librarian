import { describe, expect, test } from "bun:test";
import { extractMajorVersion, pickDefaultVersion, pickLatestForSeries, parseSeriesLabel } from "../src/ingest/github/versioning";

describe("versioning", () => {
  test("extracts major version label", () => {
    expect(extractMajorVersion("v16.2.3")).toBe("16.x");
    expect(extractMajorVersion("16.0.8")).toBe("16.x");
    expect(extractMajorVersion("release-1.2.3")).toBe("1.x");
    expect(extractMajorVersion("12.x")).toBe("12.x");
  });

  test("picks default version from tags", () => {
    const pick = pickDefaultVersion({ defaultBranch: "main", tags: ["v16.2.0", "v15.9.1"] });
    expect(pick.ref).toBe("v16.2.0");
    expect(pick.label).toBe("16.x");
  });

  test("picks default version from branch when no tags", () => {
    const pick = pickDefaultVersion({ defaultBranch: "main", tags: [] });
    expect(pick.ref).toBe("main");
    expect(pick.label).toBe("main");
  });

  test("picks latest for series", () => {
    const next = pickLatestForSeries({
      seriesLabel: "16.x",
      tags: ["v16.1.0", "v16.2.0", "v15.9.9"],
    });
    expect(next).toBe("v16.2.0");
  });

  test("parses series label", () => {
    expect(parseSeriesLabel("16.x")).toBe(16);
    expect(parseSeriesLabel("v17.x")).toBe(17);
    expect(parseSeriesLabel("main")).toBeNull();
  });
});
