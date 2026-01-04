import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function checkTreeSitter(): boolean {
  try {
    const modulePath = require.resolve("tree-sitter-wasms/package.json");
    const wasmPath = join(dirname(modulePath), "out", "tree-sitter-typescript.wasm");
    return existsSync(wasmPath);
  } catch {
    return false;
  }
}

export function checkSqliteVec(ensureVecTable: () => void): boolean {
  try {
    ensureVecTable();
    return true;
  } catch {
    return false;
  }
}
