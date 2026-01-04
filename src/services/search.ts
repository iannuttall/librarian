import type { Store } from "../store/db";
import { searchFTS, searchVec } from "../store";
import { formatQueryForEmbedding, tryEmbedText, embedText } from "../llm/embed";
import { expandQuery, getDefaultQueryModel, tryResolveQueryModel } from "../llm/expand";
import { fuseRankedLists } from "../search/hybrid";
import { loadConfig } from "../core/config";
import type { SearchRow } from "./search-format";

export type HybridMeta = {
  expandedQueries: number;
  strongSignal: boolean;
  usedRelaxed: boolean;
};

export async function searchHybridRows(
  store: Store,
  input: { query: string; version: string | null; sourceName: string },
): Promise<{ rows: SearchRow[]; meta: HybridMeta }> {
  const query = input.query;
  const version = input.version;
  const sourceName = input.sourceName;
  const queryTerms = extractSearchTerms(query);
  const ftsQuery = sanitizeFtsQuery(query);
  const vectorQuery = sanitizeVectorQuery(query);

  const initialFtsResult = runFtsWithFallback(store, ftsQuery, version, sourceName);
  const initialFts = initialFtsResult.rows;

  const config = loadConfig();
  const strongScore = config.search?.strongScore ?? 0.85;
  const strongGap = config.search?.strongGap ?? 0.15;
  const topScore = initialFts[0]?.score ?? 0;
  const secondScore = initialFts[1]?.score ?? 0;
  const hasStrongSignal = !initialFtsResult.usedRelaxed &&
    initialFts.length > 0 &&
    topScore >= strongScore &&
    (topScore - secondScore) >= strongGap;

  let expansions: string[] = [];
  if (!hasStrongSignal) {
    const modelUri = config.models?.query ?? getDefaultQueryModel();
    const existing = await tryResolveQueryModel(modelUri);
    if (existing) {
      expansions = await expandQuery(query, 2, modelUri);
    }
  }

  const rankedLists: SearchRow[][] = [];
  const weights: number[] = [];

  if (initialFts.length > 0) {
    rankedLists.push(initialFts);
    weights.push(initialFtsResult.usedRelaxed ? 1.2 : 2);
  }

  const vectorCache = new Map<string, Float32Array>();
  const getVector = async (text: string): Promise<Float32Array | null> => {
    const cached = vectorCache.get(text);
    if (cached !== undefined) return cached;
    try {
      const vector = await embedText(formatQueryForEmbedding(text));
      store.ensureVecTable(vector.length);
      vectorCache.set(text, vector);
      return vector;
    } catch {
      return null;
    }
  };

  const originalVector = await getVector(vectorQuery);
  if (originalVector) {
    const vecRows = mapVecRows(
      searchVec(store.db, originalVector, 20, version ?? undefined),
      sourceName,
    );
    if (vecRows.length > 0) {
      rankedLists.push(vecRows);
      weights.push(2);
    }
  }

  for (const alt of expansions) {
    const ftsAlt = runFtsWithFallback(store, sanitizeFtsQuery(alt), version, sourceName);
    if (ftsAlt.rows.length > 0) {
      rankedLists.push(ftsAlt.rows);
      weights.push(ftsAlt.usedRelaxed ? 0.7 : 1);
    }

    const vec = await getVector(sanitizeVectorQuery(alt));
    if (vec) {
      const vecRows = mapVecRows(
        searchVec(store.db, vec, 20, version ?? undefined),
        sourceName,
      );
      if (vecRows.length > 0) {
        rankedLists.push(vecRows);
        weights.push(1);
      }
    }
  }

  const fused = rankedLists.length > 0 ? fuseRankedLists(rankedLists, weights, 8) : [];
  const boosted = fused.map((row) => ({
    ...row,
    score: row.score + computeKeywordBoost(row, queryTerms),
  }));
  boosted.sort((a, b) => b.score - a.score);

  return {
    rows: boosted,
    meta: {
      expandedQueries: expansions.length,
      strongSignal: hasStrongSignal,
      usedRelaxed: initialFtsResult.usedRelaxed,
    },
  };
}

export function searchWordRows(
  store: Store,
  input: { query: string; version: string | null; sourceName: string },
): SearchRow[] {
  const ftsQuery = sanitizeFtsQuery(input.query);
  return mapFtsRows(searchFTS(store.db, ftsQuery, 8, input.version ?? undefined), input.sourceName);
}

export async function searchVectorRows(
  store: Store,
  input: { query: string; version: string | null; sourceName: string },
): Promise<{ rows: SearchRow[]; ok: boolean }> {
  const vectorQuery = sanitizeVectorQuery(input.query);
  const vector = await tryEmbedText(formatQueryForEmbedding(vectorQuery));
  if (!vector) return { rows: [], ok: false };
  try {
    store.ensureVecTable(vector.length);
    const rows = mapVecRows(
      searchVec(store.db, vector, 8, input.version ?? undefined),
      input.sourceName,
    );
    return { rows, ok: true };
  } catch {
    return { rows: [], ok: false };
  }
}

function runFtsWithFallback(
  store: Store,
  query: string,
  version: string | null,
  sourceName: string,
): { rows: SearchRow[]; usedRelaxed: boolean } {
  if (!query.trim()) {
    return { rows: [], usedRelaxed: false };
  }
  const base = mapFtsRows(searchFTS(store.db, query, 20, version ?? undefined), sourceName);
  if (base.length > 0) return { rows: base, usedRelaxed: false };

  const relaxed = buildRelaxedFtsQuery(query);
  if (!relaxed || relaxed === query) return { rows: base, usedRelaxed: false };
  const relaxedRows = mapFtsRows(searchFTS(store.db, relaxed, 20, version ?? undefined), sourceName);
  return { rows: relaxedRows, usedRelaxed: relaxedRows.length > 0 };
}

function mapFtsRows(
  rows: Array<{
    chunkId: number;
    docId: number;
    score: number;
    title: string;
    path: string;
    uri: string;
    contextPath: string | null;
    lineStart: number | null;
    lineEnd: number | null;
    tokenCount: number | null;
    preview: string | null;
    content: string;
  }>,
  sourceName: string,
): SearchRow[] {
  return rows.map((row) => ({
    chunkId: row.chunkId,
    docId: row.docId,
    score: row.score,
    title: row.title,
    path: row.path,
    uri: row.uri,
    sourceName,
    contextPath: row.contextPath,
    lineStart: row.lineStart,
    lineEnd: row.lineEnd,
    tokenCount: row.tokenCount,
    preview: row.preview,
  }));
}

function mapVecRows(
  rows: Array<{
    chunkId: number;
    docId: number;
    distance: number;
    title: string;
    path: string;
    uri: string;
    contextPath: string | null;
    lineStart: number | null;
    lineEnd: number | null;
    tokenCount: number | null;
    preview: string | null;
    content: string;
  }>,
  sourceName: string,
): SearchRow[] {
  return rows.map((row) => ({
    chunkId: row.chunkId,
    docId: row.docId,
    score: 1 / (1 + row.distance),
    title: row.title,
    path: row.path,
    uri: row.uri,
    sourceName,
    contextPath: row.contextPath,
    lineStart: row.lineStart,
    lineEnd: row.lineEnd,
    tokenCount: row.tokenCount,
    preview: row.preview,
  }));
}

function extractSearchTerms(input: string): string[] {
  const raw = input
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.map((term) => term.trim())
    .filter(Boolean) ?? [];
  const stopwords = new Set([
    "the", "and", "or", "for", "to", "of", "in", "on", "at", "with", "without", "from", "by", "as",
    "is", "are", "be", "can", "how", "what", "which", "when", "where", "why", "your", "you",
  ]);
  const terms = raw.filter((term) => {
    if (stopwords.has(term)) return false;
    return term.length >= 3;
  });
  return Array.from(new Set(terms));
}

function buildRelaxedFtsQuery(query: string): string | null {
  const terms = extractSearchTerms(query);
  if (terms.length === 0) return null;
  if (terms.length === 1) return `"${terms[0]}"*`;
  return terms.map((term) => `"${term}"*`).join(" OR ");
}

function sanitizeVectorQuery(input: string): string {
  return normalizeQueryText(input);
}

function sanitizeFtsQuery(input: string): string {
  const normalized = normalizeQueryText(input);
  const tokens = normalized
    .match(/[\p{L}\p{N}]+/gu)
    ?.map((term) => term.trim())
    .filter(Boolean) ?? [];
  if (tokens.length === 0) return normalized;
  return tokens.join(" AND ");
}

function normalizeQueryText(input: string): string {
  let cleaned = "";
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    cleaned += code < 32 ? " " : input.charAt(i);
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

function computeKeywordBoost(
  row: { title: string; path: string; contextPath: string | null; preview: string | null },
  terms: string[],
): number {
  if (terms.length === 0) return 0;
  const title = row.title?.toLowerCase() ?? "";
  const path = row.path?.toLowerCase() ?? "";
  const context = row.contextPath?.toLowerCase() ?? "";
  const preview = row.preview?.toLowerCase() ?? "";
  let boost = 0;
  for (const term of terms) {
    if (title.includes(term)) boost += 0.02;
    if (path.includes(term)) boost += 0.03;
    if (context.includes(term)) boost += 0.01;
    if (preview.includes(term)) boost += 0.005;
  }
  return Math.min(0.08, boost);
}
