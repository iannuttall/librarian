#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd: string, args: string[], cwd: string): void {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function hasBun(): boolean {
  const result = spawnSync("bun", ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

function getCommandHint(): string {
  const result = spawnSync("which", ["librarian"], { stdio: "ignore" });
  return result.status === 0 ? "librarian" : "./librarian";
}

async function ask(question: string): Promise<string> {
  return new Promise((resolveAnswer) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolveAnswer(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  if (!hasBun()) {
    console.log("Bun is missing. Please install Bun first.");
    console.log("Then run this again.");
    process.exit(1);
  }

  console.log("Installing packages...");
  run("bun", ["install"], root);

  let token = "";
  let model = "";
  if (process.stdin.isTTY) {
    console.log("");
    console.log("Optional setup");
    token = await ask("GitHub token (press Enter to skip): ");
    model = await ask("Model name (press Enter to use default): ");
  } else {
    console.log("");
    console.log("No terminal. Skipping prompts.");
  }

  const args = ["src/cli.ts", "setup"];
  if (token) {
    args.push("--github-token", token);
  }
  if (model) {
    args.push("--model", model);
  }

  console.log("");
  run("bun", args, root);

  console.log("");
  console.log("Done. Next steps:");
  const cmd = getCommandHint();
  console.log(`- ${cmd} source add github https://github.com/owner/repo --docs docs --ref main`);
  console.log(`- ${cmd} ingest --embed`);
  console.log(`- ${cmd} search "your words"`);
}

main().catch((err) => {
  console.log(String((err as Error)?.message ?? err));
  process.exit(1);
});
