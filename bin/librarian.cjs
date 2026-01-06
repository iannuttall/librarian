#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { dirname, join } = require("node:path");

function hasBun() {
  const result = spawnSync("bun", ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

if (!hasBun()) {
  console.error("Error: Bun is required to run Librarian.");
  console.error("Install Bun:");
  console.error("  curl -fsSL https://bun.sh/install | bash");
  console.error("Then run:");
  console.error("  librarian setup");
  process.exit(1);
}

const repoRoot = dirname(__dirname);
const cliPath = join(repoRoot, "src", "cli.ts");
process.env.LIBRARIAN_PACKAGE_JSON ??= join(repoRoot, "package.json");

const result = spawnSync("bun", [cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
