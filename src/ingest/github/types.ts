export type LoadedFile = {
  relPath: string;
  content: string;
  lang?: string;
  hash: string;
  byteSize: number;
};

export type ExtractedFile = {
  absPath: string;
  relPath: string;
};

export type SkippedFile = {
  relPath: string;
  size: number;
  maxBytes: number;
  reason: "file_too_large";
};
