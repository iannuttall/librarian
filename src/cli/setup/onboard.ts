import type { Store } from "../../store/db";
import { loadConfig, saveConfig } from "../../core/config";
import { promptLine } from "../../core/prompt";
import { addGithubSource } from "../../store";
import { parseGithubUrl, normalizeDocsPath } from "../../ingest/github/parse";
import { parseFlags } from "../flags";
import { printTokenSetupHelp } from "../tokens";
import { cmdIngest } from "../ingest";
import { runSetup } from "./run";

export async function cmdOnboard(args: string[], store: Store): Promise<void> {
  const flags = parseFlags(args);
  if (!process.stdin.isTTY || flags.noprompt) {
    console.log("This needs a terminal. Use setup, source add, and ingest instead.");
    return;
  }

  console.log("Welcome. Let's set up Librarian.");
  printTokenSetupHelp();
  const token = await promptLine("GitHub token (optional): ");
  const hfToken = await promptLine("Hugging Face token (optional): ");
  const repoUrl = await promptLine("GitHub repo URL: ");
  const docs = await promptLine("Docs path (optional): ");
  const ref = await promptLine("Branch or tag (optional): ");

  const config = loadConfig();
  if (token) {
    config.github = { ...(config.github ?? {}), token };
  }
  if (hfToken) {
    config.hf = { ...(config.hf ?? {}), token: hfToken };
  }
  saveConfig(config);
  await runSetup(config, store);

  const parsed = parseGithubUrl(repoUrl);
  if (!parsed) {
    console.log("That GitHub URL is not valid.");
    return;
  }

  const docsPath = normalizeDocsPath(docs || parsed.path || null);
  const name = `${parsed.owner}/${parsed.repo}`;
  const id = addGithubSource(store.db, {
    name,
    owner: parsed.owner,
    repo: parsed.repo,
    ref: ref || parsed.ref || null,
    docsPath,
  });
  console.log(`Added source ${id}: ${name}`);

  await cmdIngest(store, ["--source", String(id), "--embed"]);
}
