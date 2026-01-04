import type { Store } from "../store/db";
import { ensureLibraryDbPath, getSourceById } from "../store";
import { printError } from "./help";
import { existsSync } from "node:fs";

export async function cmdDb(store: Store, args: string[]): Promise<void> {
  const idRaw = args[0];
  let target = store.dbPath;
  if (idRaw) {
    const id = Number.parseInt(String(idRaw), 10);
    if (!Number.isFinite(id)) {
      printError("source id must be a number");
      process.exitCode = 1;
      return;
    }
    const source = getSourceById(store.db, id);
    if (!source) {
      printError("source not found");
      process.exitCode = 1;
      return;
    }
    target = ensureLibraryDbPath(store.db, source);
  }
  if (!existsSync(target)) {
    printError("database not found");
    console.log(`Database path: ${target}`);
    process.exitCode = 1;
    return;
  }
  const platform = process.platform;
  const command = resolveOpenCommand(platform, target);

  if (!command) {
    printError(`unsupported platform: ${platform}`);
    console.log(`Database path: ${target}`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = Bun.spawnSync(command, { stdout: "ignore", stderr: "ignore" });
    if (result.exitCode !== 0) {
      printError("could not open the database");
      console.log(`Database path: ${target}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Opened database: ${target}`);
  } catch {
    printError("could not open the database");
    console.log(`Database path: ${target}`);
    process.exitCode = 1;
  }
}

function resolveOpenCommand(platform: string, path: string): string[] | null {
  if (platform === "darwin") return ["open", path];
  if (platform === "win32") return ["cmd", "/c", "start", "", path];
  if (platform === "linux") return ["xdg-open", path];
  return null;
}
