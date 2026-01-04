import type { Store } from "../../store/db";

export function getLibraryMatches(
  store: Store,
  query: string,
  version?: string | null,
): Array<{ id: number; name: string; versions: string[]; ref: string | null }> {
  const normalizedQuery = normalizeLibraryText(query);
  const rawQuery = query.toLowerCase();
  if (!normalizedQuery && !rawQuery) return [];

  const sources = store.db.prepare(
    "SELECT id, name, owner, repo, ref, version_label FROM sources ORDER BY id ASC",
  ).all() as Array<{ id: number; name: string; owner: string | null; repo: string | null; ref: string | null; version_label: string | null }>;

  const versionRows = store.db.prepare(
    "SELECT source_id, version_label FROM source_versions ORDER BY synced_at DESC",
  ).all() as Array<{ source_id: number; version_label: string }>;

  const versionMap = new Map<number, Set<string>>();
  for (const row of versionRows) {
    if (!versionMap.has(row.source_id)) versionMap.set(row.source_id, new Set());
    versionMap.get(row.source_id)?.add(row.version_label);
  }

  const matches: Array<{ id: number; name: string; versions: string[]; ref: string | null; score: number }> = [];
  for (const source of sources) {
    const ownerRepo = source.owner && source.repo ? `${source.owner}/${source.repo}` : "";
    const name = ownerRepo || source.name;
    const score = Math.max(
      scoreLibraryMatch(rawQuery, normalizedQuery, source.name),
      ownerRepo ? scoreLibraryMatch(rawQuery, normalizedQuery, ownerRepo) : 0,
    );
    if (score <= 0) continue;

    const versions = new Set<string>();
    if (source.version_label) versions.add(source.version_label);
    const seen = versionMap.get(source.id);
    if (seen) {
      for (const label of seen) versions.add(label);
    }

    const versionList = Array.from(versions).filter(Boolean);
    if (version && !versionList.includes(version)) {
      continue;
    }

    matches.push({ id: source.id, name, versions: versionList, ref: source.ref ?? null, score });
  }

  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return matches.slice(0, 20).map((item) => ({
    id: item.id,
    name: item.name,
    versions: item.versions,
    ref: item.ref,
  }));
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
