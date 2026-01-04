import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

import { getConfigDir, ensureDir } from "./paths";

export type LibrarianConfig = {
  github?: {
    token?: string;
  };
  hf?: {
    token?: string;
  };
  models?: {
    embed?: string;
    query?: string;
    rerank?: string;
  };
  search?: {
    strongScore?: number;
    strongGap?: number;
  };
  proxy?: {
    endpoint?: string;
  };
  headless?: {
    enabled?: boolean;
    chromePath?: string;
    proxy?: string;
    timeout?: number;
  };
  crawl?: {
    concurrency?: number;
    minBodyChars?: number;
    requireCodeSnippets?: boolean;
  };
  ingest?: {
    maxMajorVersions?: number;
  };
};

export function getConfigPath(): string {
  return join(getConfigDir(), "config.yml");
}

export function loadConfig(): LibrarianConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = YAML.parse(raw) as LibrarianConfig;
    return parsed || {};
  } catch {
    return {};
  }
}

export function saveConfig(config: LibrarianConfig): void {
  ensureDir(getConfigDir());
  const yaml = YAML.stringify(config, { indent: 2, lineWidth: 0 });
  writeFileSync(getConfigPath(), yaml, "utf-8");
}
