export async function checkGlobalInstall(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "librarian"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

export function checkGlobalInstallSync(): boolean {
  try {
    const proc = Bun.spawnSync(["which", "librarian"], { stdout: "ignore", stderr: "ignore" });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

export function getCommandHintSync(): string {
  return checkGlobalInstallSync() ? "librarian" : "./librarian";
}
