import { DEFAULT_INGEST_CONCURRENCY } from "../ingest/concurrency";
import { getCommandHintSync } from "./command-hint";

export function printHelp(advanced: boolean): void {
  const cmd = getCommandHintSync();
  console.log("Librarian fetches and searches up-to-date developer docs on your machine.");
  console.log("Use it to give AI agents real context so they stop guessing and writing bad code.");
  console.log("");
  console.log("Commands:");
  console.log("  setup                       Guided setup");
  console.log("  add <url>                   Add a source (GitHub or web URL)");
  console.log("  ingest                      Ingest sources");
  console.log(`  ingest --concurrency N      Ingest with N concurrent requests (default: ${DEFAULT_INGEST_CONCURRENCY})`);
  console.log("  update                      Update sources (same as ingest)");
  console.log("  detect                      Detect package versions in cwd");
  console.log("  library <query>             Find a library and list versions");
  console.log("  search --library <name|id> <query>");
  console.log("  search --library <name|id> --mode word|vector|hybrid <query>");
  console.log("  get <path|uri>              Fetch a document");
  console.log("  get --doc <id> --slice a:b  Fetch a document slice");
  console.log("  db [sourceId]               Open the local database");
  console.log("  reset                       Delete local databases");
  console.log("  cleanup                     Remove inactive docs and data");
  console.log("  status                      Show counts");
  console.log("  seed                        Add sources from a seed file");
  console.log("");
  console.log("Tip: run `library <name>` first to find the right library, then search it.");
  if (!advanced) {
    console.log("");
    console.log("Common add flags (GitHub):");
    console.log("  --docs <path>              Docs folder in the repo");
    console.log("  --ref <tag|branch>          Git ref to ingest");
    console.log("  --version <label>           Version label like 16.x");
    console.log("  --mode docs|repo            Docs only or full repo");
    console.log("  --list-refs                 Show tags/branches and exit");
    console.log("");
    console.log(`Run ${cmd} help all to see advanced commands.`);
    return;
  }
  console.log("");
  console.log("Advanced:");
  console.log("  init                        Create config and database");
  console.log("  onboard                     Guided setup + ingest");
  console.log("  source add github <url>     Add a GitHub source");
  console.log("  source add web <url>        Add a web source");
  console.log("  source list                 List sources");
  console.log("  source remove <id>          Remove a source");
  console.log("  source update <id>          Ingest one source");
  console.log("  mcp                         Start the MCP server");
  console.log("");
  console.log("Web source options:");
  console.log("  --depth <n>                 Max crawl depth (default: 3)");
  console.log("  --pages <n>                 Max pages to crawl (default: 500)");
  console.log("  --allow <paths>             Comma-separated allowed paths");
  console.log("  --deny <paths>              Comma-separated denied paths");
  console.log("  ingest --source id          Ingest a single source");
  console.log("  ingest --embed              Ingest and embed");
  console.log("  ingest --force              Re-ingest even if unchanged");
  console.log("  embed                        Build embeddings");
  console.log("  embed --source <id>         Build embeddings for one source");
  console.log("  embed --force               Rebuild embeddings");
  console.log("  embed --safe                Run embeddings in a separate process");
  console.log("  vsearch <query>             Meaning search");
  console.log("  query <query>               Hybrid search");
  console.log("  query --json <query>        Hybrid search as JSON");
}

export function formatError(message: string): string {
  return `\u001b[31mError: ${message}\u001b[0m`;
}

export function printError(message: string): void {
  console.log(formatError(message));
}

export function printAddHelp(): void {
  const cmd = getCommandHintSync();
  console.log("Add a source");
  console.log("");
  console.log(`Usage: ${cmd} add <url>`);
  console.log(`   or: ${cmd} add owner/repo`);
  console.log(`   or: ${cmd} add github <url>`);
  console.log(`   or: ${cmd} add web <url>`);
  console.log(`   or: ${cmd} add owner/repo --list-refs`);
  console.log("");
  console.log("Examples:");
  console.log(`  ${cmd} add vercel/next.js`);
  console.log(`  ${cmd} add https://github.com/owner/repo --docs docs --ref main`);
  console.log(`  ${cmd} add https://example.com/docs --depth 2`);
  console.log(`  ${cmd} add vercel/next.js --list-refs --refs-filter 16.`);
  console.log("");
  console.log("Common GitHub flags:");
  console.log("  --docs <path>              Docs folder in the repo");
  console.log("  --ref <tag|branch>          Git ref to ingest");
  console.log("  --version <label>           Version label like 16.x");
  console.log("  --mode docs|repo            Docs only or full repo");
  console.log("  --list-refs                 Show tags/branches and exit");
}

export function printSourceHelp(): void {
  const cmd = getCommandHintSync();
  console.log("Source commands");
  console.log("");
  console.log(`Usage: ${cmd} source add github <url|owner/repo>`);
  console.log(`   or: ${cmd} source add web <url>`);
  console.log(`   or: ${cmd} source list`);
  console.log(`   or: ${cmd} source remove <id>`);
  console.log(`   or: ${cmd} source update <id>`);
  console.log(`   or: ${cmd} source add github owner/repo --list-refs`);
  console.log("");
  console.log("Examples:");
  console.log(`  ${cmd} source add github https://github.com/owner/repo --docs docs --ref main`);
  console.log(`  ${cmd} source add web https://example.com/docs --depth 2`);
}

export function formatSearchHelp(): string {
  const cmd = getCommandHintSync();
  return [
    "Search docs",
    "",
    `Usage: ${cmd} search --library <name|id> <query>`,
    `   or: ${cmd} search --library <name|id> --mode word|vector|hybrid <query>`,
    `   or: ${cmd} search --library <name|id> --version 16.x <query>`,
    "",
    "Examples:",
    `  ${cmd} search --library vercel/next.js "middleware"`,
    `  ${cmd} search --library vercel/next.js --mode word "next config"`,
    `  ${cmd} search --library vercel/next.js --version 16.x "app router"`,
  ].join("\n");
}

export function printSearchHelp(): void {
  console.log(formatSearchHelp());
}

export function printLibraryHelp(): void {
  console.log(formatLibraryHelp());
}

export function formatLibraryHelp(): string {
  const cmd = getCommandHintSync();
  return [
    "Library search",
    "",
    `Usage: ${cmd} library <query>`,
    `   or: ${cmd} library --version 16.x <query>`,
    "",
    "Examples:",
    `  ${cmd} library "nextjs"`,
    `  ${cmd} library --version 16.x "nextjs"`,
  ].join("\n");
}

export function formatGetHelp(): string {
  const cmd = getCommandHintSync();
  return [
    "Get a document",
    "",
    `Usage: ${cmd} get --library <name|id> <path|uri>`,
    `   or: ${cmd} get --library <name|id> --doc <id> --slice a:b`,
    "",
    "Examples:",
    `  ${cmd} get --library vercel/next.js docs/guide.md`,
    `  ${cmd} get --library vercel/next.js gh://owner/repo@main/docs/guide.md`,
    `  ${cmd} get --library vercel/next.js --doc 69 --slice 19:73`,
  ].join("\n");
}

export function printGetHelp(): void {
  console.log(formatGetHelp());
}

export function printQueryHelp(): void {
  console.log(formatQueryHelp());
}

export function formatQueryHelp(): string {
  const cmd = getCommandHintSync();
  return [
    "Hybrid search",
    "",
    `Usage: ${cmd} query --library <name|id> <query>`,
    `   or: ${cmd} query --library <name|id> --json <query>`,
    `   or: ${cmd} query --library <name|id> --version 16.x <query>`,
    "",
    "Examples:",
    `  ${cmd} query --library vercel/next.js "middleware"`,
    `  ${cmd} query --library vercel/next.js --json "middleware"`,
  ].join("\n");
}

export function printVSearchHelp(): void {
  const cmd = getCommandHintSync();
  console.log("Vector search");
  console.log("");
  console.log(`Usage: ${cmd} vsearch --library <name|id> <query>`);
  console.log(`   or: ${cmd} vsearch --library <name|id> --version 16.x <query>`);
  console.log("");
  console.log("Examples:");
  console.log(`  ${cmd} vsearch --library vercel/next.js "middleware"`);
}
