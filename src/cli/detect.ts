import { detectVersions, isPlatformPackage, suggestVersionLabel } from "../detect";

export async function cmdDetect(args: string[]): Promise<void> {
  const root = process.cwd();
  const versions = await detectVersions(root);
  const filtered = versions.filter((item) => !isPlatformPackage(item.name));
  if (filtered.length === 0) {
    console.log("- No versions found");
    return;
  }
  console.log("- Detected versions");
  for (const item of filtered) {
    const label = suggestVersionLabel(item.version);
    const suffix = label ? ` version: ${label}` : "";
    console.log(`- ${item.name} ${item.version} (${item.manifest})${suffix}`);
  }
}
