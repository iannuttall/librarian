import type { Store } from "../store/db";
import { createLibraryStore } from "../store/db";
import { ensureLibraryDbPath } from "../store";
import { getCommandHintSync } from "../cli/command-hint";
import { resolveLibrary } from "../cli/library-resolve";
import { formatError, formatSearchHelp } from "../cli/help";
import { formatItems, formatTiming, toItems } from "./search-format";
import { searchHybridRows, searchVectorRows, searchWordRows } from "./search";

export type SearchRunInput = {
  query: string | null | undefined;
  library: string | null | undefined;
  mode?: string | null | undefined;
  version?: string | null | undefined;
  json?: boolean | null | undefined;
  timing?: boolean | null | undefined;
  startedAt?: number | null | undefined;
  helpText?: string | null | undefined;
};

export type SearchRunResult = {
  text: string;
  isError: boolean;
};

export async function runSearch(store: Store, input: SearchRunInput): Promise<SearchRunResult> {
  const query = (input.query ?? "").trim();
  const helpText = input.helpText ?? formatSearchHelp();
  if (!query) {
    return {
      text: `${formatError("you need to provide a search query")}\n${helpText}`,
      isError: true,
    };
  }

  const library = (input.library ?? "").trim();
  if (!library) {
    return {
      text: `${formatError("you need to provide a library")}\n${helpText}`,
      isError: true,
    };
  }

  const startedAt = input.startedAt ?? Date.now();
  const mode = (input.mode ?? "hybrid").toLowerCase();
  const useJson = Boolean(input.json);
  const showTiming = Boolean(input.timing);
  const version = typeof input.version === "string" ? input.version : null;

  const resolved = resolveLibrary(store.db, library);
  if (!resolved.source) {
    if (resolved.matches.length > 1) {
      const lines = [formatError("library name is ambiguous")];
      for (const match of resolved.matches.slice(0, 5)) {
        const ownerRepo = match.owner && match.repo ? `${match.owner}/${match.repo}` : match.name;
        lines.push(`- ${match.id}. ${ownerRepo}`);
      }
      return { text: lines.join("\n"), isError: true };
    }
    return { text: formatError("library not found"), isError: true };
  }

  const sourceName = resolved.source.owner && resolved.source.repo
    ? `${resolved.source.owner}/${resolved.source.repo}`
    : resolved.source.name;

  const libraryPath = ensureLibraryDbPath(store.db, resolved.source);
  const libraryStore = await createLibraryStore(libraryPath);
  try {
    if (isHybridMode(mode)) {
      const result = await searchHybridRows(libraryStore, { query, version, sourceName });
      const items = toItems(result.rows);
      if (useJson) {
        const latencyMs = Date.now() - startedAt;
        return {
          text: JSON.stringify({
            query,
            items,
            meta: {
              latencyMs,
              expandedQueries: result.meta.expandedQueries,
              strongSignal: result.meta.strongSignal,
            },
          }, null, 2),
          isError: false,
        };
      }
      return { text: appendTiming(formatItems(items), showTiming, startedAt), isError: false };
    }

    if (isWordMode(mode)) {
      const rows = searchWordRows(libraryStore, { query, version, sourceName });
      const items = toItems(rows);
      if (useJson) {
        const latencyMs = Date.now() - startedAt;
        return {
          text: JSON.stringify({ query, mode: "word", items, meta: { latencyMs } }, null, 2),
          isError: false,
        };
      }
      return { text: appendTiming(formatItems(items), showTiming, startedAt), isError: false };
    }

    if (isVectorMode(mode)) {
      const result = await searchVectorRows(libraryStore, { query, version, sourceName });
      if (!result.ok) {
        return {
          text: `Vector search is not ready. Run ${getCommandHintSync()} embed first.`,
          isError: false,
        };
      }
      const items = toItems(result.rows);
      if (useJson) {
        const latencyMs = Date.now() - startedAt;
        return {
          text: JSON.stringify({ query, mode: "vector", items, meta: { latencyMs } }, null, 2),
          isError: false,
        };
      }
      return { text: appendTiming(formatItems(items), showTiming, startedAt), isError: false };
    }
  } finally {
    libraryStore.close();
  }

  return {
    text: `${formatError("unknown search mode")}\n${helpText}`,
    isError: true,
  };
}

function appendTiming(text: string, showTiming: boolean, startedAt: number): string {
  const line = formatTiming(showTiming, startedAt);
  if (!line) return text;
  return `${text}\n${line}`;
}

function isHybridMode(mode: string): boolean {
  return ["hybrid", "mix", "combined"].includes(mode);
}

function isWordMode(mode: string): boolean {
  return ["word", "fts", "bm25"].includes(mode);
}

function isVectorMode(mode: string): boolean {
  return ["vector", "vec", "meaning"].includes(mode);
}
