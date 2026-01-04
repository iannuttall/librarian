import { buildBreadcrumb, buildPreview, approxTokens, containsCodeSnippet } from "./utils";
import type { ChunkDraft } from "./types";

const MAX_CHUNK_TOKENS = 600;
const PREFERRED_MIN_TOKENS = 200;
const MIN_CHUNK_TOKENS = 40;
const OVERLAP_TOKENS = 60;
const PREVIEW_CHAR_LIMIT = 220;

export async function buildMarkdownChunks(input: {
  content: string;
  documentTitle?: string | null;
  prefix?: string[];
}): Promise<ChunkDraft[]> {
  const prefix = input.prefix ?? [];
  const title = (input.documentTitle ?? "Document").trim() || "Document";
  const lines = input.content.split(/\r?\n/);

  const single = tryBuildSingleChunk(lines, title, prefix);
  if (single) return [single];

  const headings = collectHeadings(lines, title);
  let chunks: ChunkDraft[] = [];
  if (headings.length > 0) {
    chunks = buildHeadingChunks(lines, headings, prefix);
  } else {
    chunks = buildFallbackChunks(lines, title, prefix);
  }

  if (chunks.length === 0) {
    chunks = buildFallbackChunks(lines, title, prefix);
  }

  return chunks;
}

type HeadingNode = {
  level: number;
  title: string;
  start: number;
  end: number;
  children: HeadingNode[];
};

function tryBuildSingleChunk(lines: string[], title: string, prefix: string[]): ChunkDraft | null {
  const content = cleanLines(lines).join("\n").trim();
  if (!content) return null;

  if (/^#{2,5}\s/m.test(content)) {
    return null;
  }

  if (!containsCodeSnippet(content)) {
    return null;
  }

  const breadcrumb = buildBreadcrumb([...prefix, title]);
  const fullContent = [breadcrumb, content].filter(Boolean).join("\n\n");
  const tokens = approxTokens(fullContent);
  if (tokens > MAX_CHUNK_TOKENS) return null;

  return makeChunk(fullContent, breadcrumb, title, 1, lines.length, "doc");
}

function collectHeadings(lines: string[], documentTitle: string): HeadingNode[] {
  const root: HeadingNode = {
    level: 1,
    title: documentTitle,
    start: 1,
    end: lines.length,
    children: [],
  };
  const stack: HeadingNode[] = [root];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx] ?? "";
    const match = line.match(/^(#{1,5})\s+(.*)$/);
    if (!match) continue;
    const level = match[1].length;
    const title = match[2].trim() || "Section";

    if (level === 1) {
      stack[0].title = title;
      continue;
    }

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      const popped = stack.pop();
      if (popped) popped.end = idx;
    }

    const parent = stack[stack.length - 1] ?? root;
    const node: HeadingNode = {
      level,
      title,
      start: idx + 1,
      end: lines.length,
      children: [],
    };
    parent.children.push(node);
    stack.push(node);
  }

  while (stack.length > 0) {
    const node = stack.pop();
    if (node) node.end = lines.length;
  }

  return root.children;
}

function buildHeadingChunks(lines: string[], headings: HeadingNode[], prefix: string[]): ChunkDraft[] {
  const sections = flattenHeadingPaths(headings);
  const chunks: ChunkDraft[] = [];

  for (const section of sections) {
    if (section.hasChildren) continue;
    const slice = cleanLines(lines.slice(section.start - 1, section.end));
    const sectionContent = slice.join("\n").trim();
    if (!sectionContent) continue;

    const breadcrumb = buildBreadcrumb([...prefix, ...section.path]);
    const content = [breadcrumb, sectionContent].filter(Boolean).join("\n\n");
    chunks.push(...enforceTokenLimit(content, breadcrumb, section.path, section.start, section.end, "doc"));
  }

  return chunks;
}

function buildFallbackChunks(lines: string[], title: string, prefix: string[]): ChunkDraft[] {
  const cleaned = cleanLines(lines);
  const text = cleaned.join("\n").trim();
  if (!text) return [];
  const breadcrumb = buildBreadcrumb([...prefix, title]);
  const content = [breadcrumb, text].filter(Boolean).join("\n\n");
  return enforceTokenLimit(content, breadcrumb, [title], 1, lines.length, "doc");
}

function enforceTokenLimit(
  content: string,
  breadcrumb: string,
  path: string[],
  startLine: number,
  endLine: number,
  chunkType: "doc" | "doc-inline",
): ChunkDraft[] {
  const tokenCount = approxTokens(content);
  if (tokenCount <= MAX_CHUNK_TOKENS) {
    return [makeChunk(content, breadcrumb, path[path.length - 1] ?? "Document", startLine, endLine, chunkType)];
  }

  const rawLines = content.split("\n");
  const chunks: ChunkDraft[] = [];
  let current: string[] = [];
  let lineCursor = 0;

  while (lineCursor < rawLines.length) {
    const line = rawLines[lineCursor] ?? "";
    current.push(line);
    const currentTokens = approxTokens(current.join("\n"));

    if (currentTokens >= MAX_CHUNK_TOKENS) {
      const chunkText = current.join("\n").trim();
      if (approxTokens(chunkText) >= MIN_CHUNK_TOKENS) {
        const chunkStart = startLine + lineCursor - current.length + 1;
        const chunkEnd = startLine + lineCursor;
        chunks.push(makeChunk(chunkText, breadcrumb, path[path.length - 1] ?? "Document", chunkStart, chunkEnd, chunkType));
      }

      const overlapLines = takeOverlapLines(current, OVERLAP_TOKENS);
      current = overlapLines;
    }

    lineCursor += 1;
  }

  if (current.length > 0) {
    const chunkText = current.join("\n").trim();
    if (approxTokens(chunkText) >= MIN_CHUNK_TOKENS) {
      const chunkStart = endLine - current.length + 1;
      chunks.push(makeChunk(chunkText, breadcrumb, path[path.length - 1] ?? "Document", chunkStart, endLine, chunkType));
    }
  }

  if (chunks.length === 0 && tokenCount > 0) {
    const chunkText = clampToTokens(content, MAX_CHUNK_TOKENS);
    chunks.push(makeChunk(chunkText, breadcrumb, path[path.length - 1] ?? "Document", startLine, endLine, chunkType));
  }

  return mergeSmallChunks(chunks);
}

function mergeSmallChunks(chunks: ChunkDraft[]): ChunkDraft[] {
  if (chunks.length <= 1) return chunks;
  const merged: ChunkDraft[] = [];
  let buffer: ChunkDraft | null = null;

  for (const chunk of chunks) {
    if (!buffer) {
      buffer = chunk;
      continue;
    }

    if (buffer.tokenCount < PREFERRED_MIN_TOKENS) {
      const combined = `${buffer.content}\n\n${chunk.content}`.trim();
      const tokens = approxTokens(combined);
      if (tokens <= MAX_CHUNK_TOKENS) {
        buffer = {
          ...buffer,
          content: combined,
          tokenCount: tokens,
          preview: buildPreview(combined, PREVIEW_CHAR_LIMIT),
          lineEnd: chunk.lineEnd ?? buffer.lineEnd,
        };
        continue;
      }
    }

    merged.push(buffer);
    buffer = chunk;
  }

  if (buffer) merged.push(buffer);
  return merged;
}

function takeOverlapLines(lines: string[], overlapTokens: number): string[] {
  const overlap: string[] = [];
  let tokens = 0;
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    const line = lines[idx] ?? "";
    overlap.unshift(line);
    tokens += approxTokens(line);
    if (tokens >= overlapTokens) break;
  }
  return overlap;
}

function clampToTokens(text: string, limit: number): string {
  if (approxTokens(text) <= limit) return text;
  const chars = Math.max(1, Math.floor(limit * 4));
  return text.slice(0, chars).trimEnd();
}

function makeChunk(
  content: string,
  breadcrumb: string,
  title: string,
  startLine: number,
  endLine: number,
  chunkType: "doc" | "doc-inline",
): ChunkDraft {
  return {
    content,
    tokenCount: approxTokens(content),
    chunkType,
    contextPath: breadcrumb,
    title,
    preview: buildPreview(content, PREVIEW_CHAR_LIMIT),
    lineStart: startLine,
    lineEnd: endLine,
  };
}

function cleanLines(lines: string[]): string[] {
  return lines.map((line) => line.replace(/\s+$/g, ""));
}

type Section = {
  path: string[];
  start: number;
  end: number;
  hasChildren: boolean;
};

function flattenHeadingPaths(nodes: HeadingNode[], prefix: string[] = []): Section[] {
  const result: Section[] = [];
  for (const node of nodes) {
    const path = [...prefix, node.title];
    result.push({
      path,
      start: node.start,
      end: node.end,
      hasChildren: node.children.length > 0,
    });
    if (node.children.length > 0) {
      result.push(...flattenHeadingPaths(node.children, path));
    }
  }
  return result;
}
