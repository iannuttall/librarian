import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFileDir, getCacheDir } from "../core/paths";

const PACKAGE_NAME = "@iannuttall/librarian";
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}`;
const UPDATE_CACHE_PATH = join(getCacheDir(), "update.json");
const DAY_MS = 24 * 60 * 60 * 1000;

type InstallKind = "bun" | "npm" | "local" | "unknown";
type UpdateCommand = { bin: string; args: string[]; pretty: string };

function getRepoRoot(): string {
  let currentDir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(currentDir, "package.json");
    if (existsSync(candidate)) {
      return currentDir;
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

function detectLocalInstallCommand(): string {
  const repoRoot = getRepoRoot();
  const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;
  const hasNpmLock = existsSync(join(repoRoot, "package-lock.json"));
  const hasPnpmLock = existsSync(join(repoRoot, "pnpm-lock.yaml"));
  const hasYarnLock = existsSync(join(repoRoot, "yarn.lock"));
  const hasBunLock = existsSync(join(repoRoot, "bun.lockb"));

  if (hasBunLock && hasBun) return "git pull && bun install";
  if (hasNpmLock) return "git pull && npm install";
  if (hasPnpmLock) return "git pull && pnpm install";
  if (hasYarnLock) return "git pull && yarn install";
  if (hasBun) return "git pull && bun install";
  return "git pull && npm install";
}

function readPackageJson(): { name?: string; version?: string } {
  try {
    const content = readFileSync(join(getRepoRoot(), "package.json"), "utf8");
    return JSON.parse(content) as { name?: string; version?: string };
  } catch {
    return {};
  }
}

function getInstalledVersion(): string {
  const pkg = readPackageJson();
  return pkg.version ?? "0.0.0";
}

function detectInstallKind(): InstallKind {
  const root = getRepoRoot().replaceAll("\\", "/");
  if (root.includes("/node_modules/")) {
    if (root.includes("/.bun/")) return "bun";
    if (root.includes("/.pnpm/")) return "unknown";
    return "npm";
  }
  return "local";
}

function getUpdateCommand(kind: InstallKind): UpdateCommand | null {
  if (kind === "bun") {
    return { bin: "bun", args: ["add", "-g", `${PACKAGE_NAME}@latest`], pretty: `bun add -g ${PACKAGE_NAME}@latest` };
  }
  if (kind === "npm") {
    return { bin: "npm", args: ["i", "-g", `${PACKAGE_NAME}@latest`], pretty: `npm i -g ${PACKAGE_NAME}@latest` };
  }
  return null;
}

function parseVersion(raw: string): { major: number; minor: number; patch: number; pre: string | null } {
  const cleaned = raw.trim().replace(/^v/, "");
  const [core, pre] = cleaned.split("-", 2);
  const parts = core.split(".").map((part) => Number.parseInt(part, 10));
  return {
    major: Number.isFinite(parts[0]) ? parts[0] : 0,
    minor: Number.isFinite(parts[1]) ? parts[1] : 0,
    patch: Number.isFinite(parts[2]) ? parts[2] : 0,
    pre: pre ?? null,
  };
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre.localeCompare(right.pre);
}

function readUpdateCache(): { lastCheckedAt?: string } {
  try {
    const content = readFileSync(UPDATE_CACHE_PATH, "utf8");
    return JSON.parse(content) as { lastCheckedAt?: string };
  } catch {
    return {};
  }
}

function writeUpdateCache(): void {
  ensureFileDir(UPDATE_CACHE_PATH);
  writeFileSync(UPDATE_CACHE_PATH, JSON.stringify({ lastCheckedAt: new Date().toISOString() }), "utf8");
}

async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(REGISTRY_URL, {
      headers: { accept: "application/vnd.npm.install-v1+json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json() as { ["dist-tags"]?: { latest?: string } };
    return payload["dist-tags"]?.latest ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function shouldCheckForUpdates(): boolean {
  const cache = readUpdateCache();
  if (!cache.lastCheckedAt) return true;
  const last = Date.parse(cache.lastCheckedAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last > DAY_MS;
}

function printUpdateHint(kind: InstallKind): void {
  const updateCommand = getUpdateCommand(kind);
  if (updateCommand) {
    console.log(`Run: ${updateCommand.pretty}`);
    return;
  }
  if (kind === "local") {
    console.log("You're running from a local checkout.");
    console.log(`Pull updates: ${detectLocalInstallCommand()}`);
    console.log(`Or install globally: bun add -g ${PACKAGE_NAME}@latest`);
    return;
  }
  console.log("Unable to detect install method.");
  console.log(`Try: bun add -g ${PACKAGE_NAME}@latest`);
  console.log(`   or: npm i -g ${PACKAGE_NAME}@latest`);
}

export function cmdVersion(): void {
  console.log(getInstalledVersion());
}

export async function cmdUpdate(): Promise<void> {
  const kind = detectInstallKind();
  const updateCommand = getUpdateCommand(kind);
  if (!updateCommand) {
    printUpdateHint(kind);
    return;
  }
  const result = spawnSync(updateCommand.bin, updateCommand.args, { stdio: "inherit" });
  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  process.exit(1);
}

export async function maybeCheckForUpdate(_command: string, argv: string[]): Promise<void> {
  const canPrint = process.stdout.isTTY && !argv.includes("--json");
  if (!shouldCheckForUpdates()) return;

  const latest = await fetchLatestVersion();
  writeUpdateCache();
  if (!latest) return;

  const current = getInstalledVersion();
  if (compareVersions(latest, current) <= 0) return;

  if (!canPrint) return;
  console.log(`Update available: ${current} → ${latest}`);
  printUpdateHint(detectInstallKind());
}
