export interface CrawlConfig {
  rootUrl: string;
  allowedPaths: string[];
  deniedPaths: string[];
  maxDepth: number;
  maxPages: number;
  allowSubdomains: boolean;
  requireCodeSnippets: boolean;
  minBodyCharacters: number;
  allowHeadless: boolean;
  forceHeadless: boolean;
}

export interface CrawlResult {
  url: string;
  title: string | null;
  markdown: string;
  path: string;
  links: string[];
}

export interface CrawlPageRow {
  id: number;
  source_id: number;
  url: string;
  normalized_url: string;
  depth: number;
  status: "pending" | "fetching" | "done" | "failed";
  last_crawled_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtractOptions {
  mdMaxBytes?: number;
  mdMaxLines?: number;
  minBodyChars?: number;
}

export interface ExtractResult {
  markdown: string;
  title: string;
  description?: string;
  isSparse: boolean;
}

export function createDefaultCrawlConfig(rootUrl: string): CrawlConfig {
  const parsed = new URL(rootUrl);
  const rootPath = parsed.pathname.replace(/\/$/, "");

  return {
    rootUrl,
    allowedPaths: rootPath ? [rootPath] : [],
    deniedPaths: [],
    maxDepth: 3,
    maxPages: 500,
    allowSubdomains: false,
    requireCodeSnippets: true,
    minBodyCharacters: 200,
    allowHeadless: true,
    forceHeadless: false,
  };
}
