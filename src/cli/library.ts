import { parseArgs } from "node:util";
import type { Store } from "../store/db";
import { runLibrary } from "../services/library-run";

export async function cmdLibrary(store: Store, args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      timing: { type: "boolean" },
      version: { type: "string" },
    },
  });
  const result = runLibrary(store, {
    query: parsed.positionals.join(" ").trim(),
    version: typeof parsed.values.version === "string" ? parsed.values.version : null,
    json: Boolean(parsed.values.json),
    timing: Boolean(parsed.values.timing),
  });
  console.log(result.text);
  if (result.isError) process.exitCode = 1;
}
