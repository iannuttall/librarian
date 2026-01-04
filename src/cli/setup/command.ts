import type { Store } from "../../store/db";
import { loadConfig, saveConfig } from "../../core/config";
import { getCacheDir } from "../../core/paths";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promptConfirm, promptLine } from "../../core/prompt";
import { parseFlags } from "../flags";
import { printTokenSetupHelp } from "../tokens";
import { cmdInit } from "./init";
import { runSetup } from "./run";

export async function cmdSetup(args: string[], store: Store): Promise<void> {
  cmdInit();
  const flags = parseFlags(args);
  const noPrompt = Boolean(flags.noprompt);
  const config = loadConfig();
  if (flags["github-token"]) {
    config.github = { ...(config.github ?? {}), token: flags["github-token"] };
  }
  if (flags.model) {
    config.models = { ...(config.models ?? {}), embed: flags.model };
  }

  let downloadEmbed: boolean | null = null;
  let downloadQuery: boolean | null = null;

  if (noPrompt) {
    downloadEmbed = false;
    downloadQuery = false;
  }

  if (process.stdin.isTTY && !noPrompt) {
    printTokenSetupHelp();
    const hasGithubToken = Boolean(config.github?.token);
    const hasHfToken = Boolean(config.hf?.token);

    if (flags["github-token"]) {
      console.log("GitHub token: set from flag");
    } else if (hasGithubToken) {
      console.log("GitHub token: already set");
      console.log("Use --github-token to replace it.");
    } else {
      const token = await promptLine("GitHub token (optional): ");
      if (token) {
        config.github = { ...(config.github ?? {}), token };
      }
    }

    if (hasHfToken) {
      console.log("Hugging Face token: already set");
      console.log("Edit config.yml to replace it.");
    } else {
      const hfToken = await promptLine("Hugging Face token (optional): ");
      if (hfToken) {
        config.hf = { ...(config.hf ?? {}), token: hfToken };
      }
    }

    downloadEmbed = await promptConfirm("Download embedding model now? (y/N): ");
    downloadQuery = await promptConfirm("Download query expansion model now? (y/N): ");
  }

  const detectedQueryModel = findLocalQueryModel();
  if (detectedQueryModel) {
    const current = config.models?.query;
    if (!current || current.startsWith("hf:")) {
      config.models = { ...(config.models ?? {}), query: detectedQueryModel };
    }
  }

  saveConfig(config);
  await runSetup(config, store, { downloadEmbed, downloadQuery });
}

function findLocalQueryModel(): string | null {
  const dir = join(getCacheDir(), "models");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir);
  const candidates = files.filter((file) => file.toLowerCase().endsWith(".gguf"));
  const exact = candidates.find((file) => file.toLowerCase() === "hf_qwen_qwen3-0.6b-q8_0.gguf");
  if (exact) return join(dir, exact);

  const fallback = candidates.find((file) => {
    const lower = file.toLowerCase();
    return lower.includes("qwen3") && lower.includes("0.6b") && !lower.includes("reranker");
  });
  return fallback ? join(dir, fallback) : null;
}
