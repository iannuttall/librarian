import { parseArgs } from "node:util";
import type { Store } from "../store/db";
import { runGet } from "../services/get-run";

export async function cmdGet(store: Store, args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      slice: { type: "string" },
      doc: { type: "string" },
      library: { type: "string" },
    },
  });
  const target = parsed.positionals.join(" ").trim();
  const sliceParam = typeof parsed.values.slice === "string" ? parsed.values.slice : null;
  const docIdValue = typeof parsed.values.doc === "string" ? Number(parsed.values.doc) : null;
  const libraryValue = typeof parsed.values.library === "string" ? parsed.values.library : null;

  const result = await runGet(store, {
    library: libraryValue,
    pathOrUri: target,
    docId: docIdValue,
    slice: sliceParam,
  });
  console.log(result.text);
  if (result.isError) process.exitCode = 1;
}
