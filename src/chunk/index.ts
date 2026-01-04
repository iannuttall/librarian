import { buildMarkdownChunks } from "./markdown";
import { buildCodeChunkDrafts, normalizeLanguageId } from "./code";
import type { ChunkDraft } from "./types";

const MARKDOWN_EXTS = new Set(["md", "mdx", "markdown", "rst", "adoc", "txt"]);

export async function buildDocumentChunks(input: {
  content: string;
  filePath: string;
  title?: string | null;
  prefix?: string[];
}): Promise<ChunkDraft[]> {
  const ext = getExtension(input.filePath);
  const isMarkdown = ext ? MARKDOWN_EXTS.has(ext) : false;

  if (isMarkdown) {
    return buildMarkdownChunks({
      content: input.content,
      documentTitle: input.title ?? null,
      prefix: input.prefix,
    });
  }

  const language = normalizeLanguageId(ext ?? undefined) ?? ext ?? null;
  return buildCodeChunkDrafts({
    content: input.content,
    filePath: input.filePath,
    language,
    prefix: input.prefix,
  });
}

function getExtension(filePath: string): string | null {
  const base = filePath.split("/").pop() ?? filePath;
  const parts = base.split(".");
  if (parts.length <= 1) return null;
  const ext = parts[parts.length - 1];
  return ext ? ext.toLowerCase() : null;
}
