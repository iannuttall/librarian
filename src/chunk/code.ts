import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import Parser from "web-tree-sitter";
import type { Language, Node as ParserNode } from "web-tree-sitter";

import { buildBreadcrumb, buildPreview, approxTokens, wrapCodeFence } from "./utils";
import type { ChunkDraft } from "./types";

const require = createRequire(import.meta.url);

const TARGET_TOKENS = 320;
const CODE_OVERLAP_LINES = 8;
const MAX_TOKENS = 1000;
const MERGE_COMBINED_MAX_TOKENS = 800;
const MIN_TOKENS = 50;
const PREVIEW_CHAR_LIMIT = 220;

type NormalizedLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "php"
  | "ruby"
  | "swift"
  | "kotlin"
  | "c"
  | "cpp"
  | "c_sharp";

const LANGUAGE_ALIASES: Record<string, NormalizedLanguage> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  py: "python",
  python: "python",
  go: "go",
  golang: "go",
  rs: "rust",
  rust: "rust",
  java: "java",
  php: "php",
  rb: "ruby",
  ruby: "ruby",
  swift: "swift",
  kt: "kotlin",
  kotlin: "kotlin",
  c: "c",
  "c++": "cpp",
  cpp: "cpp",
  cxx: "cpp",
  c_sharp: "c_sharp",
  "c#": "c_sharp",
};

const wasmBasePath = path.join(
  path.dirname(require.resolve("tree-sitter-wasms/package.json")),
  "out",
);

let treeSitterReady = false;
const languageCache = new Map<NormalizedLanguage, Language>();

async function ensureParserInit() {
  if (!treeSitterReady) {
    await Parser.init();
    treeSitterReady = true;
  }
}

async function loadLanguage(lang: NormalizedLanguage): Promise<Language> {
  const cached = languageCache.get(lang);
  if (cached) return cached;
  await ensureParserInit();
  const wasmPath = path.join(wasmBasePath, `tree-sitter-${lang}.wasm`);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`tree-sitter wasm for "${lang}" not found. Expected at ${wasmPath}`);
  }
  const language = await Parser.Language.load(wasmPath);
  languageCache.set(lang, language);
  return language;
}

export function normalizeLanguageId(raw?: string | null): NormalizedLanguage | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/[^a-z0-9_+#]+/g, "");
  return LANGUAGE_ALIASES[key] ?? null;
}

export type CodeChunkResult = {
  text: string;
  startLine: number;
  endLine: number;
  symbolName?: string;
  symbolType?: string;
  symbolId?: string;
  partIndex?: number;
  partCount?: number;
  language?: string | null;
};

export type BuildCodeChunksInput = {
  code: string;
  language?: string | null;
  baseStartLine?: number;
};

export async function buildCodeChunksRaw(
  input: BuildCodeChunksInput,
): Promise<CodeChunkResult[]> {
  const normalized = normalizeLanguageId(input.language ?? undefined);
  if (!normalized) {
    return chunkByLinesFallback(input.code, input.baseStartLine ?? 1);
  }

  try {
    const language = await loadLanguage(normalized);
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(input.code);
    if (!tree) {
      return chunkByLinesFallback(input.code, input.baseStartLine ?? 1, {
        language: normalized,
      });
    }
    const root = tree.rootNode;
    const symbolNodes = collectSymbolNodes(root);
    if (symbolNodes.length === 0) {
      return chunkByLinesFallback(input.code, input.baseStartLine ?? 1, {
        language: normalized,
      });
    }

    const codeLines = input.code.split("\n");
    const chunks: CodeChunkResult[] = [];

    for (const node of symbolNodes) {
      const symbolChunks = chunkSymbolLines({
        node,
        lines: codeLines,
        baseStartLine: input.baseStartLine ?? 1,
        language: normalized,
      });
      chunks.push(...symbolChunks);
    }

    if (chunks.length === 0) {
      return chunkByLinesFallback(input.code, input.baseStartLine ?? 1, {
        language: normalized,
      });
    }

    return chunks;
  } catch {
    return chunkByLinesFallback(input.code, input.baseStartLine ?? 1, {
      language: normalized ?? input.language ?? null,
    });
  }
}

function collectSymbolNodes(root: ParserNode): ParserNode[] {
  const nodes: ParserNode[] = [];
  const stack: ParserNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || !node.isNamed) continue;
    if (isSymbolNode(node)) {
      nodes.push(node);
    }
    for (const child of node.namedChildren) {
      if (child) stack.push(child);
    }
  }

  nodes.sort((a, b) => a.startIndex - b.startIndex);
  return nodes;
}

function isSymbolNode(node: ParserNode): boolean {
  const type = node.type;
  return (
    type.includes("function") ||
    type.includes("method") ||
    type.includes("class") ||
    type.includes("interface") ||
    type.includes("struct") ||
    type.includes("enum")
  );
}

function inferSymbolName(node: ParserNode): string | undefined {
  const candidate = node.childForFieldName("name") ?? node.childForFieldName("identifier");
  if (candidate?.text) return candidate.text;
  for (const child of node.namedChildren) {
    if (!child) continue;
    if (
      child.type.includes("identifier") ||
      child.type === "property_identifier" ||
      child.type === "type_identifier"
    ) {
      if (child.text) return child.text;
    }
  }
  return undefined;
}

function chunkSymbolLines(input: {
  node: ParserNode;
  lines: string[];
  baseStartLine: number;
  language: string;
}): CodeChunkResult[] {
  const startRow = input.node.startPosition.row;
  const endRow = input.node.endPosition.row;
  const parts: CodeChunkResult[] = [];
  const nodeLines = input.lines.slice(startRow, endRow + 1);
  if (nodeLines.length === 0) return parts;

  let chunkLines: string[] = [];
  let chunkStart = 0;
  const symbolName = inferSymbolName(input.node);
  const symbolType = input.node.type;
  const symbolId = symbolName
    ? `${symbolName}-${input.node.startIndex}-${input.node.endIndex}`
    : `${symbolType}-${input.node.startIndex}-${input.node.endIndex}`;

  for (let index = 0; index < nodeLines.length; index += 1) {
    const line = nodeLines[index] ?? "";
    chunkLines.push(line);

    const tokenCount = approxTokens(chunkLines.join("\n"));
    if (tokenCount >= TARGET_TOKENS) {
      const startLine = input.baseStartLine + startRow + chunkStart;
      const endLine = input.baseStartLine + startRow + index;
      parts.push({
        text: chunkLines.join("\n"),
        startLine,
        endLine,
        symbolName,
        symbolType,
        symbolId,
        partIndex: parts.length,
        partCount: 0,
        language: input.language,
      });

      const overlapStart = Math.max(0, chunkLines.length - CODE_OVERLAP_LINES);
      chunkLines = chunkLines.slice(overlapStart);
      chunkStart = index - (chunkLines.length - 1);
    }
  }

  if (chunkLines.length > 0) {
    const startLine = input.baseStartLine + startRow + chunkStart;
    const endLine = input.baseStartLine + startRow + nodeLines.length - 1;
    parts.push({
      text: chunkLines.join("\n"),
      startLine,
      endLine,
      symbolName,
      symbolType,
      symbolId,
      partIndex: parts.length,
      partCount: 0,
      language: input.language,
    });
  }

  if (parts.length > 1) {
    for (const part of parts) {
      part.partCount = parts.length;
    }
  }

  return parts;
}

function chunkByLinesFallback(
  code: string,
  baseStartLine: number,
  opts: { language?: string | null } = {},
): CodeChunkResult[] {
  const lines = code.split("\n");
  const chunks: CodeChunkResult[] = [];
  let current: string[] = [];
  let startLine = baseStartLine;

  for (let index = 0; index < lines.length; index += 1) {
    current.push(lines[index] ?? "");
    const tokenCount = approxTokens(current.join("\n"));
    if (tokenCount >= TARGET_TOKENS) {
      const endLine = baseStartLine + index;
      chunks.push({
        text: current.join("\n"),
        startLine,
        endLine,
        language: opts.language ?? null,
      });
      const overlapStart = Math.max(0, current.length - CODE_OVERLAP_LINES);
      current = current.slice(overlapStart);
      startLine = endLine - current.length + 1;
    }
  }

  if (current.length > 0) {
    chunks.push({
      text: current.join("\n"),
      startLine,
      endLine: baseStartLine + lines.length - 1,
      language: opts.language ?? null,
    });
  }

  return chunks;
}

export async function buildCodeChunkDrafts(input: {
  content: string;
  filePath: string;
  language?: string | null;
  prefix?: string[];
}): Promise<ChunkDraft[]> {
  const prefix = input.prefix ?? [];
  const rawChunks = await buildCodeChunksRaw({
    code: input.content,
    language: input.language ?? null,
    baseStartLine: 1,
  });

  if (rawChunks.length === 0) {
    return [formatFallbackChunk(input.content, input.filePath, input.language ?? null, prefix)];
  }

  const result: ChunkDraft[] = [];
  for (const chunk of rawChunks) {
    const text = chunk.text.trim();
    if (!text) continue;
    const breadcrumb = buildBreadcrumb([...prefix, input.filePath, chunk.symbolName ?? null]);
    const fenced = wrapCodeFence(text, input.language ?? null);
    const content = `${breadcrumb}\n\n${fenced}`;
    const tokens = approxTokens(content);

    if (tokens > MAX_TOKENS) {
      const parts = splitLargeCodeChunk(text);
      for (let idx = 0; idx < parts.length; idx += 1) {
        const partText = parts[idx] ?? "";
        result.push(formatChunk({
          breadcrumb,
          code: partText,
          language: input.language ?? null,
          symbol: chunk,
          partIndex: idx,
          partCount: parts.length,
        }));
      }
      continue;
    }

    result.push(formatChunk({
      breadcrumb,
      code: text,
      language: input.language ?? null,
      symbol: chunk,
    }));
  }

  const merged = mergeSymbolChunks(result);
  return pruneRedundantNestedChunks(merged);
}

function formatChunk(input: {
  breadcrumb: string;
  code: string;
  language: string | null;
  symbol: CodeChunkResult;
  partIndex?: number;
  partCount?: number;
}): ChunkDraft {
  const content = `${input.breadcrumb}\n\n${wrapCodeFence(input.code, input.language)}`;
  return {
    content,
    tokenCount: approxTokens(content),
    chunkType: "code",
    contextPath: input.breadcrumb,
    title: input.symbol.symbolName ?? path.basename(input.breadcrumb),
    preview: buildPreview(input.code, PREVIEW_CHAR_LIMIT),
    lineStart: input.symbol.startLine ?? null,
    lineEnd: input.symbol.endLine ?? null,
    language: input.language ?? null,
    symbolName: input.symbol.symbolName ?? null,
    symbolType: input.symbol.symbolType ?? null,
    symbolId: input.symbol.symbolId ?? null,
    symbolPartIndex: input.partIndex ?? null,
    symbolPartCount: input.partCount ?? null,
  };
}

function formatFallbackChunk(code: string, filePath: string, language: string | null, prefix: string[]): ChunkDraft {
  const breadcrumb = buildBreadcrumb([...prefix, filePath, null]);
  const content = `${breadcrumb}\n\n${wrapCodeFence(code, language)}`;
  return {
    content,
    tokenCount: approxTokens(content),
    chunkType: "code",
    contextPath: breadcrumb,
    title: path.basename(filePath),
    preview: buildPreview(code, PREVIEW_CHAR_LIMIT),
    lineStart: null,
    lineEnd: null,
    language: language ?? null,
  };
}

function splitLargeCodeChunk(code: string): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  const lines = code.split("\n");
  for (const line of lines) {
    current.push(line);
    const content = current.join("\n");
    if (approxTokens(content) >= MAX_TOKENS) {
      segments.push(content);
      current = [];
    }
  }
  if (current.length > 0) {
    segments.push(current.join("\n"));
  }
  return segments;
}

function mergeSymbolChunks(chunks: ChunkDraft[]): ChunkDraft[] {
  if (chunks.length < 2) return chunks;
  const merged: ChunkDraft[] = [];
  let buffer: ChunkDraft | null = null;

  for (const chunk of chunks) {
    if (buffer && canMerge(buffer, chunk) && combinedTokens(buffer, chunk) <= MERGE_COMBINED_MAX_TOKENS) {
      buffer = mergeChunks(buffer, chunk);
      continue;
    }
    if (buffer) merged.push(buffer);
    buffer = chunk;
  }

  if (buffer) merged.push(buffer);
  return merged;
}

function canMerge(a: ChunkDraft, b: ChunkDraft): boolean {
  const aSymbol = a.symbolName ?? null;
  const bSymbol = b.symbolName ?? null;
  return (
    a.chunkType === "code" &&
    b.chunkType === "code" &&
    aSymbol !== null &&
    aSymbol === bSymbol &&
    (a.symbolType ?? null) === (b.symbolType ?? null) &&
    (a.contextPath ?? null) === (b.contextPath ?? null) &&
    (a.language ?? null) === (b.language ?? null)
  );
}

function combinedTokens(a: ChunkDraft, b: ChunkDraft): number {
  const breadcrumb = a.contextPath ?? "";
  const language = a.language ?? null;
  const code = `${extractCode(a.content)}\n${extractCode(b.content)}`.trim();
  const content = `${breadcrumb}\n\n${wrapCodeFence(code, language)}`;
  return approxTokens(content);
}

function mergeChunks(a: ChunkDraft, b: ChunkDraft): ChunkDraft {
  const breadcrumb = a.contextPath ?? "";
  const language = a.language ?? null;
  const code = `${extractCode(a.content)}\n${extractCode(b.content)}`.trim();
  const content = `${breadcrumb}\n\n${wrapCodeFence(code, language)}`;
  return {
    ...a,
    content,
    tokenCount: approxTokens(content),
    preview: buildPreview(code, PREVIEW_CHAR_LIMIT),
    lineStart: minLine(a.lineStart, b.lineStart),
    lineEnd: maxLine(a.lineEnd, b.lineEnd),
    symbolPartIndex: null,
    symbolPartCount: null,
  };
}

function extractCode(content: string): string {
  const match = content.match(/```[^\n]*\n([\s\S]*)```/);
  if (match?.[1]) return match[1].trimEnd();
  return content.trim();
}

function minLine(a?: number | null, b?: number | null): number | null {
  const values = [a, b].filter((v) => typeof v === "number") as number[];
  if (values.length === 0) return null;
  return Math.min(...values);
}

function maxLine(a?: number | null, b?: number | null): number | null {
  const values = [a, b].filter((v) => typeof v === "number") as number[];
  if (values.length === 0) return null;
  return Math.max(...values);
}

function pruneRedundantNestedChunks(chunks: ChunkDraft[]): ChunkDraft[] {
  if (chunks.length <= 1) return chunks;
  const kept: ChunkDraft[] = [];

  for (const chunk of chunks) {
    const code = extractCode(chunk.content);
    const start = chunk.lineStart ?? null;
    const end = chunk.lineEnd ?? null;
    let drop = false;

    if (code && start !== null && end !== null && chunk.tokenCount < MIN_TOKENS) {
      for (const other of chunks) {
        if (other === chunk) continue;
        const oStart = other.lineStart ?? null;
        const oEnd = other.lineEnd ?? null;
        if (oStart === null || oEnd === null) continue;
        if (oStart <= start && oEnd >= end) {
          const otherCode = extractCode(other.content);
          if (otherCode.includes(code)) {
            drop = true;
            break;
          }
        }
      }
    }

    if (!drop) kept.push(chunk);
  }

  return kept;
}
