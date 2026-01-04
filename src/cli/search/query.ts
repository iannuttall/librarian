import { parseArgs } from "node:util";
import type { Store } from "../../store/db";
import { runSearch } from "../../services/search-run";
import { formatQueryHelp } from "../help";

export async function cmdQuery(store: Store, args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      timing: { type: "boolean" },
      version: { type: "string" },
      library: { type: "string" },
    },
  });
  const query = parsed.positionals.join(" ").trim();
  const result = await runSearch(store, {
    query,
    library: typeof parsed.values.library === "string" ? parsed.values.library : null,
    mode: "hybrid",
    version: typeof parsed.values.version === "string" ? parsed.values.version : null,
    json: Boolean(parsed.values.json),
    timing: Boolean(parsed.values.timing),
    helpText: formatQueryHelp(),
  });
  console.log(result.text);
  if (result.isError) process.exitCode = 1;
}
