import { parseArgs } from "node:util";

export type SearchContext = {
  query: string;
  mode: string;
  useJson: boolean;
  showTiming: boolean;
  version: string | null;
  library: string | null;
  sourceName?: string;
  startedAt: number;
};

export function parseSearchArgs(args: string[]): SearchContext {
  const startedAt = Date.now();
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      mode: { type: "string" },
      json: { type: "boolean" },
      timing: { type: "boolean" },
      version: { type: "string" },
      library: { type: "string" },
    },
  });
  const query = parsed.positionals.join(" ").trim();
  if (!query) throw new Error("search requires a query");
  const mode = String(parsed.values.mode ?? "hybrid").toLowerCase();
  const useJson = Boolean(parsed.values.json);
  const showTiming = Boolean(parsed.values.timing);
  const version = typeof parsed.values.version === "string" ? parsed.values.version : null;
  const library = typeof parsed.values.library === "string" ? parsed.values.library : null;

  return {
    query,
    mode,
    useJson,
    showTiming,
    version,
    library,
    startedAt,
  };
}
