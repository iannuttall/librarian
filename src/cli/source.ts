import type { Store } from "../store/db";
import { listSources, removeSource } from "../store";
import { parseGithubUrl } from "../ingest/github/parse";
import { cmdIngest } from "./ingest";
import { printAddHelp, printError, printSourceHelp } from "./help";
import { cmdSourceAddGithub } from "./source/github";
import { cmdSourceAddWeb } from "./source/web";
import { parseFlags } from "./flags";

export async function cmdSource(store: Store, args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub) {
    printError("you need a source command");
    printSourceHelp();
    process.exitCode = 1;
    return;
  }
  if (sub === "list") {
    const rows = listSources(store.db);
    if (rows.length === 0) {
      console.log("No sources.");
      return;
    }
    for (const row of rows) {
      const last = row.last_sync_at ? `last: ${row.last_sync_at}` : "last: never";
      const ref = row.ref ? `@${row.ref}` : "";
      const docs = row.docs_path ? `docs: ${row.docs_path}` : "";
      const mode = row.ingest_mode ? `mode: ${row.ingest_mode}` : "";
      const version = row.version_label ? `version: ${row.version_label}` : "";
      console.log(`${row.id}. ${row.name} (${row.kind}) ${ref} ${docs} ${mode} ${version} ${last}`);
    }
    return;
  }

  if (sub === "remove") {
    const id = Number(args[1]);
    if (!id) {
      printError("you need a source id");
      printSourceHelp();
      process.exitCode = 1;
      return;
    }
    removeSource(store.db, id);
    console.log(`Removed source ${id}`);
    return;
  }

  if (sub === "update") {
    const id = Number(args[1]);
    if (!id) {
      printError("you need a source id");
      printSourceHelp();
      process.exitCode = 1;
      return;
    }
    await cmdIngest(store, ["--source", String(id)]);
    return;
  }

  if (sub === "add" && args[1] === "github") {
    const addArgs = args.slice(2);
    const id = await cmdSourceAddGithub(store, addArgs);
    await maybeAutoIngest(store, id, addArgs);
    return;
  }

  if (sub === "add" && args[1] === "web") {
    const url = args[2];
    if (!url || url.startsWith("-")) {
      printError("you need a source URL");
      printSourceHelp();
      process.exitCode = 1;
      return;
    }
    const addArgs = args.slice(3);
    const id = await cmdSourceAddWeb(store, url, addArgs);
    await maybeAutoIngest(store, id, addArgs);
    return;
  }

  printError("unknown source command");
  printSourceHelp();
  process.exitCode = 1;
}

export async function cmdAdd(store: Store, args: string[]): Promise<void> {
  if (args.length === 0) {
    printError("you need to add a source URL");
    printAddHelp();
    process.exitCode = 1;
    return;
  }
  let url = args[0];
  let rest = args.slice(1);

  if (url === "github") {
    url = args[1];
    rest = args.slice(2);
    if (!url) {
      printError("you need a GitHub URL");
      printAddHelp();
      process.exitCode = 1;
      return;
    }
    const id = await cmdSourceAddGithub(store, [url, ...rest]);
    await maybeAutoIngest(store, id, rest);
    return;
  }
  if (url === "web") {
    url = args[1];
    rest = args.slice(2);
    if (!url) {
      printError("you need a web URL");
      printAddHelp();
      process.exitCode = 1;
      return;
    }
    const id = await cmdSourceAddWeb(store, url, rest);
    await maybeAutoIngest(store, id, rest);
    return;
  }

  if (!url) {
    printError("you need to add a source URL");
    printAddHelp();
    process.exitCode = 1;
    return;
  }

  if (!url.includes("://") && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(url)) {
    url = `https://github.com/${url}`;
  }

  const parsed = parseGithubUrl(url);
  if (parsed) {
    const id = await cmdSourceAddGithub(store, [url, ...rest]);
    await maybeAutoIngest(store, id, rest);
  } else if (url.startsWith("http://") || url.startsWith("https://")) {
    const id = await cmdSourceAddWeb(store, url, rest);
    await maybeAutoIngest(store, id, rest);
  } else {
    printError("that does not look like a GitHub or web URL");
    printAddHelp();
    process.exitCode = 1;
  }
}

async function maybeAutoIngest(store: Store, id: number | null, args: string[]): Promise<void> {
  if (!id) return;
  const flags = parseFlags(args);
  const noIngest = Boolean(flags["no-ingest"]);
  const noEmbed = Boolean(flags["no-embed"]);
  if (noIngest) return;
  const ingestArgs = ["--source", String(id)];
  if (!noEmbed) ingestArgs.push("--embed");
  await cmdIngest(store, ingestArgs);
}
