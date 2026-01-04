export type ChunkDraft = {
  content: string;
  tokenCount: number;
  chunkType: "code" | "doc" | "doc-inline";
  contextPath?: string | null;
  title?: string | null;
  preview?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  charStart?: number | null;
  charEnd?: number | null;
  language?: string | null;
  symbolName?: string | null;
  symbolType?: string | null;
  symbolId?: string | null;
  symbolPartIndex?: number | null;
  symbolPartCount?: number | null;
};
