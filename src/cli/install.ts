import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, readlinkSync, symlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";

type ShellType = "sh" | "fish";

const LOCAL_BIN_DIR = join(homedir(), ".local", "bin");
const SHELL_MARKER = "# Librarian";

function getRepoRoot(): string {
  const scriptDir = dirname(new URL(import.meta.url).pathname);
  return dirname(scriptDir);
}

function getShellType(): ShellType {
  const shell = process.env.SHELL ? basename(process.env.SHELL) : "";
  return shell === "fish" ? "fish" : "sh";
}

function getRcFiles(): string[] {
  const home = homedir();
  const candidates = [
    join(home, ".zshrc"),
    join(home, ".bashrc"),
    join(home, ".bash_profile"),
    join(home, ".profile"),
    join(home, ".config", "fish", "config.fish"),
  ];

  const existing = candidates.filter((path) => existsSync(path));
  const preferred = getShellType() === "fish"
    ? join(home, ".config", "fish", "config.fish")
    : process.env.SHELL?.includes("zsh")
      ? join(home, ".zshrc")
      : join(home, ".bashrc");

  if (!existing.includes(preferred)) {
    existing.unshift(preferred);
  }

  const unique: string[] = [];
  for (const path of existing) {
    if (!unique.includes(path)) unique.push(path);
  }
  return unique;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function hasLocalBinInPath(): boolean {
  const path = process.env.PATH ?? "";
  return path.split(":").includes(LOCAL_BIN_DIR);
}

function buildShellBlock(type: ShellType): string {
  if (type === "fish") {
    return `${SHELL_MARKER}
set -gx PATH $HOME/.local/bin $PATH
`;
  }
  return `${SHELL_MARKER}
export PATH="$HOME/.local/bin:$PATH"
`;
}

function appendShellBlock(rcPath: string): boolean {
  const isFish = rcPath.endsWith("config.fish");
  const block = buildShellBlock(isFish ? "fish" : "sh");
  const marker = SHELL_MARKER;
  const content = existsSync(rcPath) ? readFileSync(rcPath, "utf8") : "";
  if (content.includes(marker) || content.includes(".local/bin")) {
    return false;
  }
  ensureDir(dirname(rcPath));
  const next = content.endsWith("\n") || content.length === 0 ? content : `${content}\n`;
  writeFileSync(rcPath, `${next}\n${block}`, "utf8");
  return true;
}

export function installShellCommand(): { ok: boolean; updatedRc: string[]; info: string[] } {
  const repoRoot = getRepoRoot();
  const shimSource = join(repoRoot, "librarian");
  const targetDir = LOCAL_BIN_DIR;
  const targetPath = join(targetDir, "librarian");
  const info: string[] = [];

  ensureDir(targetDir);

  if (existsSync(targetPath)) {
    try {
      const stat = lstatSync(targetPath);
      if (stat.isSymbolicLink()) {
        const link = readlinkSync(targetPath);
        if (link === shimSource) {
          info.push("Command: already linked");
        } else {
          info.push("Command: exists (not updated)");
        }
      } else {
        info.push("Command: exists (not updated)");
      }
    } catch {
      info.push("Command: exists (not updated)");
    }
  } else {
    try {
      symlinkSync(shimSource, targetPath);
      info.push("Command: linked");
    } catch {
      info.push("Command: failed to link");
    }
  }

  const updatedRc: string[] = [];
  if (!hasLocalBinInPath()) {
    const rcFiles = getRcFiles();
    for (const rcPath of rcFiles) {
      try {
        const updated = appendShellBlock(rcPath);
        if (updated) updatedRc.push(rcPath);
      } catch {
        // ignore
      }
    }
  }

  const ok = info.some((line) => line.includes("linked")) || hasLocalBinInPath() || updatedRc.length > 0;
  return { ok, updatedRc, info };
}
