import type { Database } from "bun:sqlite";
import { getSourceById, listSources } from "../store";
import type { SourceRow } from "../store";

export function resolveLibrary(db: Database, input: string | null | undefined): {
  source: SourceRow | null;
  matches: SourceRow[];
} {
  const raw = (input ?? "").trim();
  if (!raw) {
    return { source: null, matches: [] };
  }

  const asNumber = Number.parseInt(raw, 10);
  if (Number.isFinite(asNumber) && String(asNumber) === raw) {
    const byId = getSourceById(db, asNumber);
    return { source: byId ?? null, matches: byId ? [byId] : [] };
  }

  const sources = listSources(db);
  const lower = raw.toLowerCase();
  const exact = sources.find((source) => {
    const name = source.name.toLowerCase();
    const ownerRepo = source.owner && source.repo ? `${source.owner}/${source.repo}`.toLowerCase() : "";
    return name === lower || ownerRepo === lower;
  });
  if (exact) return { source: exact, matches: [exact] };

  const normalizedQuery = normalizeLibraryText(raw);
  const matches = sources
    .map((source) => {
      const ownerRepo = source.owner && source.repo ? `${source.owner}/${source.repo}` : "";
      const score = Math.max(
        scoreLibraryMatch(lower, normalizedQuery, source.name),
        ownerRepo ? scoreLibraryMatch(lower, normalizedQuery, ownerRepo) : 0,
      );
      return { source, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length === 0) return { source: null, matches: [] };
  const topScore = matches[0]?.score ?? 0;
  const best = matches.filter((entry) => entry.score === topScore);
  if (best.length === 1) return { source: best[0].source, matches: [best[0].source] };
  return { source: null, matches: best.map((entry) => entry.source) };
}

function scoreLibraryMatch(rawQuery: string, normalizedQuery: string, candidate: string): number {
  if (!candidate) return 0;
  const lower = candidate.toLowerCase();
  const normalized = normalizeLibraryText(candidate);
  let score = 0;
  if (rawQuery && lower === rawQuery) score = Math.max(score, 100);
  if (normalizedQuery && normalized === normalizedQuery) score = Math.max(score, 95);
  if (rawQuery && lower.includes(rawQuery)) {
    score = Math.max(score, 80 - Math.min(20, lower.indexOf(rawQuery)));
  }
  if (normalizedQuery && normalized.includes(normalizedQuery)) {
    score = Math.max(score, 70 - Math.min(20, normalized.indexOf(normalizedQuery)));
  }
  return score;
}

function normalizeLibraryText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
