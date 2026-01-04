import type { Store } from "../store/db";
import { parseSearchArgs } from "./search/args";
import { cmdQuery } from "./search/query";
import { printError, printSearchHelp, printVSearchHelp } from "./help";
import { runSearch } from "../services/search-run";

export async function cmdSearch(store: Store, args: string[]): Promise<void> {
  let ctx: ReturnType<typeof parseSearchArgs>;
  try {
    ctx = parseSearchArgs(args);
  } catch {
    printError("you need to provide a search query");
    printSearchHelp();
    process.exitCode = 1;
    return;
  }

  const result = await runSearch(store, {
    query: ctx.query,
    library: ctx.library,
    mode: ctx.mode,
    version: ctx.version,
    json: ctx.useJson,
    timing: ctx.showTiming,
    startedAt: ctx.startedAt,
  });
  console.log(result.text);
  if (result.isError) process.exitCode = 1;
}

export async function cmdVSearch(store: Store, args: string[]): Promise<void> {
  if (args.length === 0) {
    printError("you need to provide a query");
    printVSearchHelp();
    process.exitCode = 1;
    return;
  }
  await cmdSearch(store, ["--mode", "vector", ...args]);
}

export { cmdQuery };
