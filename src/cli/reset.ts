import { parseArgs } from "node:util";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { getDefaultDbPath, getLibraryDbDir, getCacheDir } from "../core/paths";
import { promptConfirm } from "../core/prompt";
import { printError } from "./help";

export async function cmdReset(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      yes: { type: "boolean" },
      noprompt: { type: "boolean" },
    },
  });
  const noPrompt = Boolean(parsed.values.noprompt);
  const force = Boolean(parsed.values.yes) || noPrompt;

  if (!force) {
    if (!process.stdin.isTTY) {
      printError("reset needs --yes when there is no prompt");
      process.exitCode = 1;
      return;
    }
    const ok = await promptConfirm("Delete local databases? (y/N): ");
    if (!ok) {
      console.log("Cancelled.");
      return;
    }
  }

  const indexPath = getDefaultDbPath();
  const legacyPath = `${indexPath}.legacy`;
  const walPath = `${indexPath}-wal`;
  const shmPath = `${indexPath}-shm`;
  const libraryDir = getLibraryDbDir();
  const markerPath = `${getCacheDir()}/.fresh`;

  let removed = 0;
  if (existsSync(indexPath)) {
    rmSync(indexPath, { force: true });
    removed += 1;
  }
  if (existsSync(walPath)) {
    rmSync(walPath, { force: true });
    removed += 1;
  }
  if (existsSync(shmPath)) {
    rmSync(shmPath, { force: true });
    removed += 1;
  }
  if (existsSync(legacyPath)) {
    rmSync(legacyPath, { force: true });
    removed += 1;
  }
  if (existsSync(libraryDir)) {
    rmSync(libraryDir, { recursive: true, force: true });
    removed += 1;
  }
  rmSync(markerPath, { force: true });
  if (removed > 0) {
    try {
      writeFileSync(markerPath, "skip-legacy-migration");
    } catch {
      // ignore
    }
  }

  if (removed === 0) {
    console.log("No local databases found.");
    return;
  }
  console.log("Local databases deleted.");
}
