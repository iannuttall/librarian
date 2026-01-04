export const DEFAULT_INGEST_CONCURRENCY = 5;

export function resolveIngestConcurrency(value?: string | number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed) || !parsed) return DEFAULT_INGEST_CONCURRENCY;
  return Math.max(1, Math.floor(parsed));
}

export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void> | void,
): Promise<void> {
  if (items.length === 0) return;
  const safeLimit = Math.max(1, Math.floor(limit));
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) break;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}
