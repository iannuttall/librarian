import type { Store } from "../../store/db";
import { addWebSource } from "../../store";
import { parseFlags } from "../flags";

export async function cmdSourceAddWeb(store: Store, url: string, args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const parsedUrl = new URL(url);

  const name = flags.name ?? parsedUrl.hostname;
  const maxDepth = flags.depth ? Number(flags.depth) : 3;
  const maxPages = flags.pages ? Number(flags.pages) : 500;
  const versionLabel = flags.version ?? null;

  const denyPathsRaw = flags.deny ?? "";
  const allowPathsRaw = flags.allow ?? "";

  const allowedPaths = allowPathsRaw
    ? String(allowPathsRaw)
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
    : [];
  const deniedPaths = denyPathsRaw
    ? String(denyPathsRaw)
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
    : [];

  if (allowedPaths.length === 0 && parsedUrl.pathname !== "/") {
    allowedPaths.push(parsedUrl.pathname.replace(/\/$/, ""));
  }

  const id = addWebSource(store.db, {
    name,
    rootUrl: url,
    allowedPaths,
    deniedPaths,
    maxDepth,
    maxPages,
    versionLabel,
  });

  console.log(`Added web source ${id}: ${name}`);
  console.log(`  URL: ${url}`);
  console.log(`  Max depth: ${maxDepth}, Max pages: ${maxPages}`);
  if (allowedPaths.length) console.log(`  Allowed paths: ${allowedPaths.join(", ")}`);
  if (deniedPaths.length) console.log(`  Denied paths: ${deniedPaths.join(", ")}`);
  return id;
}
