export type SearchHit = {
  chunkId: number;
  docId: number;
  score: number;
  source: "fts" | "vec";
  title: string;
  path: string;
  uri: string;
  sourceName: string;
  contextPath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  tokenCount: number | null;
  preview: string | null;
  content: string;
};

export function fuseResults(fts: SearchHit[], vec: SearchHit[], limit: number): SearchHit[] {
  const k = 60;
  const scores = new Map<number, { hit: SearchHit; score: number }>();

  const add = (hits: SearchHit[]) => {
    hits.forEach((hit, idx) => {
      const existing = scores.get(hit.chunkId);
      const rrf = 1 / (k + idx + 1);
      if (!existing) {
        scores.set(hit.chunkId, { hit, score: rrf });
      } else {
        existing.score += rrf;
      }
    });
  };

  add(fts);
  add(vec);

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({ ...entry.hit, score: entry.score }));
}

export function fuseRankedLists(
  lists: SearchHit[][],
  weights: number[] = [],
  limit = 8,
): SearchHit[] {
  const k = 60;
  const scores = new Map<number, { hit: SearchHit; score: number; bestRank: number }>();

  for (const [listIndex, list] of lists.entries()) {
    const weight = weights[listIndex] ?? 1;
    for (const [idx, hit] of list.entries()) {
      const existing = scores.get(hit.chunkId);
      const rank = idx + 1;
      const rrf = weight / (k + rank);
      if (!existing) {
        scores.set(hit.chunkId, { hit, score: rrf, bestRank: rank });
      } else {
        existing.score += rrf;
        if (rank < existing.bestRank) existing.bestRank = rank;
      }
    }
  }

  for (const entry of scores.values()) {
    if (entry.bestRank === 1) entry.score += 0.05;
    else if (entry.bestRank <= 3) entry.score += 0.02;
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({ ...entry.hit, score: entry.score }));
}
