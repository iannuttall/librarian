import { join } from "node:path";
import type { loadConfig } from "../../core/config";
import { getConfigDir, getDefaultDbPath, getCacheDir } from "../../core/paths";
import { promptConfirm } from "../../core/prompt";
import {
  ensureEmbeddingModel,
  getDefaultEmbedModel,
  tryResolveEmbeddingModel,
} from "../../llm/embed";
import { getDefaultQueryModel, ensureQueryModel, tryResolveQueryModel } from "../../llm/expand";
import { findChromeBinaryPath, getChromeVersion, getInstallInstructions } from "../../ingest/web/headless";
import type { Store } from "../../store/db";
import { checkTreeSitter, checkSqliteVec } from "../checks";
import { checkGlobalInstall, getCommandHintSync } from "../command-hint";
import { installShellCommand } from "../install";
import { printSetupGuide } from "../next-steps";
import { applyHfToken } from "../tokens";

export async function runSetup(
  config: ReturnType<typeof loadConfig>,
  store: Store,
  options?: { downloadEmbed?: boolean | null; downloadQuery?: boolean | null; installGlobal?: boolean | null },
): Promise<void> {
  await applyHfToken(config);
  console.log(`Bun: ${Bun.version}`);
  console.log(`Config: ${join(getConfigDir(), "config.yml")}`);
  console.log(`DB: ${getDefaultDbPath()}`);
  console.log(`Cache: ${getCacheDir()}`);

  const vecOk = checkSqliteVec(() => store.ensureVecTable());
  console.log(`Vector: ${vecOk ? "ok" : "missing"}`);

  const modelUri = config.models?.embed ?? getDefaultEmbedModel();
  const existingModel = await tryResolveEmbeddingModel(modelUri);
  const downloadEmbed = options?.downloadEmbed ?? null;
  if (existingModel) {
    console.log(`Model: ${existingModel}`);
  } else if (downloadEmbed === true) {
    const modelPath = await ensureEmbeddingModel(modelUri);
    console.log(`Model: ${modelPath}`);
  } else if (downloadEmbed === false) {
    console.log("Model: skipped");
  } else if (process.stdin.isTTY) {
    const ok = await promptConfirm("Download embedding model now? (y/N): ");
    if (ok) {
      const modelPath = await ensureEmbeddingModel(modelUri);
      console.log(`Model: ${modelPath}`);
    } else {
      console.log("Model: skipped");
    }
  } else {
    console.log("Model: missing");
    console.log(`Run ${getCommandHintSync()} setup to download the model.`);
  }

  const queryModelUri = config.models?.query ?? getDefaultQueryModel();
  const existingQueryModel = await tryResolveQueryModel(queryModelUri);
  const downloadQuery = options?.downloadQuery ?? null;
  const hasHfToken = Boolean(process.env.LIBRARIAN_HF_TOKEN || process.env.HUGGINGFACE_TOKEN);
  if (existingQueryModel) {
    console.log(`Query model: ${existingQueryModel}`);
  } else if (downloadQuery === true) {
    if (!hasHfToken) {
      console.log("Query model: skipped (token required)");
    } else {
      const modelPath = await ensureQueryModel(queryModelUri);
      console.log(`Query model: ${modelPath}`);
    }
  } else if (downloadQuery === false) {
    console.log("Query model: skipped");
  } else if (process.stdin.isTTY) {
    const ok = await promptConfirm("Download query expansion model now? (y/N): ");
    if (ok) {
      if (!hasHfToken) {
        console.log("Query model: skipped (token required)");
      } else {
        const modelPath = await ensureQueryModel(queryModelUri);
        console.log(`Query model: ${modelPath}`);
      }
    } else {
      console.log("Query model: skipped");
    }
  } else {
    console.log("Query model: missing");
    console.log(`Run ${getCommandHintSync()} setup to download the model.`);
  }

  const ok = checkTreeSitter();
  console.log(`Tree parser: ${ok ? "ok" : "missing"}`);

  const chromePath = findChromeBinaryPath(config.headless?.chromePath);
  if (chromePath) {
    const version = getChromeVersion(chromePath);
    console.log(`Chrome: ${version ?? "found"} (${chromePath})`);
  } else {
    console.log("Chrome: not found (needed for CSR sites)");
    if (process.stdin.isTTY) {
      console.log(getInstallInstructions());
    }
  }

  let globalHint = await checkGlobalInstall();
  if (globalHint) {
    console.log("Global: installed");
  } else if (process.stdin.isTTY && options?.installGlobal !== false) {
    const shouldInstall =
      options?.installGlobal === true ||
      await promptConfirm("Add 'librarian' to your command line? (y/N): ");
    if (shouldInstall) {
      const result = installShellCommand();
      for (const line of result.info) {
        console.log(line);
      }
      if (result.updatedRc.length > 0) {
        console.log("Shell: updated");
        console.log("Reload your shell to use the command.");
      }
      if (result.ok) {
        console.log("Global: installed");
        globalHint = true;
      } else {
        console.log(`Global: failed (you can still use ${getCommandHintSync()})`);
      }
    } else {
      console.log("Global: skipped");
    }
  } else {
    console.log(`Global: not installed (use ${getCommandHintSync()} or run setup)`);
  }

  printSetupGuide(globalHint);
}
