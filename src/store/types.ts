export type SourceRow = {
  id: number;
  kind: string;
  name: string;
  owner: string | null;
  repo: string | null;
  ref: string | null;
  docs_path: string | null;
  ingest_mode: string | null;
  version_label: string | null;
  db_path: string | null;
  last_sync_at: string | null;
  last_commit: string | null;
  last_etag: string | null;
  last_error: string | null;
  // Web source fields
  root_url: string | null;
  allowed_paths: string | null;
  denied_paths: string | null;
  max_depth: number | null;
  max_pages: number | null;
};

export type CrawlPageRow = {
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
};
