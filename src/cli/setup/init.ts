import { join } from "node:path";
import { loadConfig, saveConfig } from "../../core/config";
import { getConfigDir, getDefaultDbPath } from "../../core/paths";

export function cmdInit(): void {
  const config = loadConfig();
  saveConfig(config);
  console.log(`Config: ${join(getConfigDir(), "config.yml")}`);
  console.log(`DB: ${getDefaultDbPath()}`);
}
