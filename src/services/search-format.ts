export type SearchRow = {
  chunkId: number;
  docId: number;
  score: number;
  title: string;
  path: string;
  uri: string;
  sourceName: string;
  contextPath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  tokenCount: number | null;
  preview: string | null;
};

export type SearchItem = {
  chunkId: number;
  documentId: number;
  title: string;
  path: string;
  uri: string;
  sourceName: string;
  contextPath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  slice: string | null;
  preview: string | null;
  tokenCount: number | null;
  score: number;
  confidence: number;
};

export function toItems(rows: SearchRow[]): SearchItem[] {
  const maxScore = rows.reduce((acc, row) => Math.max(acc, row.score), 0);
  return rows.map((row) => ({
    chunkId: row.chunkId,
    documentId: row.docId,
    title: row.title,
    path: row.path,
    uri: row.uri,
    sourceName: row.sourceName,
    contextPath: row.contextPath,
    lineStart: row.lineStart,
    lineEnd: row.lineEnd,
    slice: row.lineStart && row.lineEnd ? `${row.lineStart}:${row.lineEnd}` : null,
    preview: row.preview,
    tokenCount: row.tokenCount,
    score: row.score,
    confidence: maxScore > 0 ? Math.max(0, Math.min(1, row.score / maxScore)) : 0,
  }));
}

export function formatItems(items: SearchItem[]): string {
  if (items.length === 0) {
    return "No results found.";
  }
  const lines = [
    "- use `librarian get --library <name|id> --doc <id> --slice start:end` (or the MCP get tool) to fetch the exact matching part.",
    "- use `librarian get --library <name|id> --doc <id>` without a slice if you need the full document.",
    "",
    "Results",
    "---",
  ];
  for (const row of items) {
    const slice = row.slice ?? "n/a";
    lines.push(`- ${row.sourceName}: ${row.title} (${row.path}) doc ${row.documentId} slice ${slice} score ${row.confidence.toFixed(2)}`);
  }
  return lines.join("\n");
}

export function formatTiming(showTiming: boolean, startedAt: number): string | null {
  if (!showTiming) return null;
  return `Time: ${Date.now() - startedAt} ms`;
}
