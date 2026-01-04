import { promises as fs } from "node:fs";
import * as path from "node:path";

export type DetectedVersion = {
  name: string;
  version: string;
  manifest: string;
};

const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".vscode",
  ".cache",
  "dist",
  "build",
  ".next",
  ".svelte-kit",
  ".turbo",
  "coverage",
  "tmp",
]);

const TARGET_FILES = new Set([
  "package.json",
  "composer.json",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
]);

export async function detectVersions(root: string): Promise<DetectedVersion[]> {
  const manifests: string[] = [];
  await walk(root, root, 0, manifests);
  const results: DetectedVersion[] = [];

  for (const manifest of manifests) {
    if (manifest.endsWith("package.json")) {
      results.push(...(await readPackageJson(manifest, root)));
    } else if (manifest.endsWith("composer.json")) {
      results.push(...(await readComposerJson(manifest, root)));
    } else if (manifest.endsWith("pyproject.toml")) {
      results.push(...(await readPyprojectToml(manifest, root)));
    } else if (manifest.endsWith("requirements.txt")) {
      results.push(...(await readRequirementsTxt(manifest, root)));
    } else if (manifest.endsWith("Pipfile")) {
      results.push(...(await readPipfile(manifest, root)));
    } else if (manifest.endsWith("go.mod")) {
      results.push(...(await readGoMod(manifest, root)));
    } else if (manifest.endsWith("Cargo.toml")) {
      results.push(...(await readCargoToml(manifest, root)));
    } else if (manifest.endsWith("Gemfile")) {
      results.push(...(await readGemfile(manifest, root)));
    } else if (manifest.endsWith("pom.xml")) {
      results.push(...(await readPomXml(manifest, root)));
    } else if (manifest.endsWith("build.gradle") || manifest.endsWith("build.gradle.kts")) {
      results.push(...(await readGradle(manifest, root)));
    }
  }

  return results;
}

export function isPlatformPackage(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.includes("darwin") || lower.includes("linux") || lower.includes("win32") || lower.includes("windows")) {
    return true;
  }
  if (lower.endsWith("-x64") || lower.endsWith("-arm64") || lower.endsWith("-amd64")) {
    return true;
  }
  return false;
}

export function suggestVersionLabel(version: string): string | null {
  const trimmed = version.trim();
  if (!trimmed || trimmed === "*" || trimmed === "latest") return null;
  const match = trimmed.match(/(\d+)\./) ?? trimmed.match(/(\d+)/);
  if (!match) return null;
  const major = match[1];
  if (!major) return null;
  return `${major}.x`;
}

async function walk(root: string, current: string, depth: number, out: string[]) {
  if (depth > 6) return;
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isDirectory()) {
      if (name.startsWith(".")) continue;
      if (SKIP_DIRS.has(name)) continue;
      await walk(root, path.join(current, name), depth + 1, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TARGET_FILES.has(name)) continue;
    out.push(path.join(current, name));
  }
}

async function readPackageJson(filePath: string, root: string): Promise<DetectedVersion[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const deps = {
      ...(data.dependencies ?? {}),
      ...(data.optionalDependencies ?? {}),
      ...(data.peerDependencies ?? {}),
    };
    return formatDeps(deps, filePath, root);
  } catch {
    return [];
  }
}

async function readComposerJson(filePath: string, root: string): Promise<DetectedVersion[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as { require?: Record<string, string> };
    const deps = { ...(data.require ?? {}) };
    return formatDeps(deps, filePath, root);
  } catch {
    return [];
  }
}

async function readPyprojectToml(filePath: string, root: string): Promise<DetectedVersion[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const deps: Record<string, string> = {};
    const lines = raw.split(/\r?\n/);
    let section = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sectionMatch = trimmed.match(/^\[(.+)\]$/);
      if (sectionMatch) {
        section = sectionMatch[1] ?? "";
        continue;
      }
      if (section === "tool.poetry.dependencies") {
        const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*\"([^\"]+)\"/);
        if (match) {
          const name = match[1];
          const version = match[2];
          if (name && name !== "python") deps[name] = version;
        }
      }
      if (section === "project") {
        const match = trimmed.match(/^dependencies\s*=\s*\[(.*)\]\s*$/);
        if (match) {
          const list = match[1] ?? "";
          const items = list.split(",").map((item) => item.trim().replace(/^\"|\"$/g, ""));
          for (const item of items) {
            if (!item) continue;
            const parts = item.split(/\s+/);
            const name = parts[0];
            const version = item.replace(name, "").trim() || "*";
            deps[name] = version;
          }
        }
      }
    }
    return formatDeps(deps, filePath, root);
  } catch {
    return [];
  }
}

async function readRequirementsTxt(filePath: string, root: string): Promise<DetectedVersion[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const deps: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.startsWith("-r") || trimmed.startsWith("--")) continue;
      const match = trimmed.match(/^([A-Za-z0-9_.-]+)(==|>=|<=|~=|>|<)?\s*([^\s;]+)?/);
      if (match) {
        const name = match[1];
        const version = match[3] ?? "*";
        if (name) deps[name] = version;
      }
    }
    return formatDeps(deps, filePath, root);
  } catch {
    return [];
  }
}

async function readPipfile(filePath: string, root: string): Promise<DetectedVersion[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const deps: Record<string, string> = {};
    const lines = raw.split(/\r?\n/);
    let section = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sectionMatch = trimmed.match(/^\[(.+)\]$/);
      if (sectionMatch) {
        section = sectionMatch[1] ?? "";
        continue;
      }
      if (section === "packages") {
        const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*\"([^\"]+)\"/);
        if (match) {
          deps[match[1]] = match[2];
        }
      }
    }
    return formatDeps(deps, filePath, root);
  } catch {
    return [];
  }
}

async function readGoMod(filePath: string, root: string): Promise<DetectedVersion[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const deps: Record<string, string> = {};
    const lines = raw.split(/\r?\n/);
    let inRequireBlock = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("require (")) {
        inRequireBlock = true;
        continue;
      }
      if (inRequireBlock && trimmed === ")") {
        inRequireBlock = false;
        continue;
      }
      if (trimmed.startsWith("require ") && !inRequireBlock) {
        const rest = trimmed.replace(/^require\s+/, "");
        const parts = rest.split(/\s+/);
        if (parts.length >= 2) deps[parts[0]] = parts[1];
        continue;
      }
      if (inRequireBlock) {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) deps[parts[0]] = parts[1];
      }
    }
    return formatDeps(deps, filePath, root);
  } catch {
    return [];
  }
}

async function readCargoToml(filePath: string, root: string): Promise<DetectedVersion[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const deps: Record<string, string> = {};
    const lines = raw.split(/\r?\n/);
    let section = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sectionMatch = trimmed.match(/^\[(.+)\]$/);
      if (sectionMatch) {
        section = sectionMatch[1] ?? "";
        continue;
      }
      if (section === "dependencies") {
        const simple = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*\"([^\"]+)\"/);
        if (simple) {
          deps[simple[1]] = simple[2];
          continue;
        }
        const complex = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*\{(.+)\}/);
        if (complex) {
          const name = complex[1];
          const body = complex[2];
          const versionMatch = body.match(/version\s*=\s*\"([^\"]+)\"/);
          deps[name] = versionMatch ? versionMatch[1] : "*";
        }
      }
    }
    return formatDeps(deps, filePath, root);
  } catch {
    return [];
  }
}

async function readGemfile(filePath: string, root: string): Promise<DetectedVersion[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const deps: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^gem\s+\"([A-Za-z0-9_.-]+)\"\s*(,\s*\"([^\"]+)\")?/);
      if (match) {
        const name = match[1];
        const version = match[3] ?? "*";
        deps[name] = version;
      }
    }
    return formatDeps(deps, filePath, root);
  } catch {
    return [];
  }
}

async function readPomXml(filePath: string, root: string): Promise<DetectedVersion[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const deps: Record<string, string> = {};
    const depRegex = /<dependency>([\s\S]*?)<\/dependency>/g;
    for (let match = depRegex.exec(raw); match; match = depRegex.exec(raw)) {
      const block = match[1] ?? "";
      const scopeMatch = block.match(/<scope>\s*([^<]+)\s*<\/scope>/);
      if (scopeMatch && scopeMatch[1]?.trim() === "test") continue;
      const groupMatch = block.match(/<groupId>\s*([^<]+)\s*<\/groupId>/);
      const artifactMatch = block.match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/);
      const versionMatch = block.match(/<version>\s*([^<]+)\s*<\/version>/);
      if (groupMatch && artifactMatch) {
        const name = `${groupMatch[1].trim()}:${artifactMatch[1].trim()}`;
        deps[name] = versionMatch ? versionMatch[1].trim() : "*";
      }
    }
    return formatDeps(deps, filePath, root);
  } catch {
    return [];
  }
}

async function readGradle(filePath: string, root: string): Promise<DetectedVersion[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const deps: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      const match = trimmed.match(/(?:^|\s)(implementation|api)\s+['"]([^'"]+)['"]/);
      if (match) {
        const coords = match[2];
        const parts = coords.split(":");
        if (parts.length >= 3) {
          const name = `${parts[0]}:${parts[1]}`;
          const version = parts.slice(2).join(":");
          deps[name] = version;
        }
      }
    }
    return formatDeps(deps, filePath, root);
  } catch {
    return [];
  }
}

function formatDeps(
  deps: Record<string, string>,
  filePath: string,
  root: string,
): DetectedVersion[] {
  const manifest = path.relative(root, filePath) || path.basename(filePath);
  return Object.entries(deps)
    .filter(([name, version]) => name && version)
    .map(([name, version]) => ({ name, version, manifest }));
}
