import type { Store } from "../store/db";
import { getLibraryMatches } from "../cli/search/library";
import { formatError, formatLibraryHelp } from "../cli/help";

export type LibraryRunInput = {
  query: string | null | undefined;
  version?: string | null | undefined;
  json?: boolean | null | undefined;
  timing?: boolean | null | undefined;
  startedAt?: number | null | undefined;
};

export type LibraryRunResult = {
  text: string;
  isError: boolean;
};

export function runLibrary(store: Store, input: LibraryRunInput): LibraryRunResult {
  const startedAt = input.startedAt ?? Date.now();
  const query = (input.query ?? "").trim();
  if (!query) {
    return {
      text: `${formatError("you need to provide a search term")}\n${formatLibraryHelp()}`,
      isError: true,
    };
  }

  const useJson = Boolean(input.json);
  const showTiming = Boolean(input.timing);
  const version = typeof input.version === "string" ? input.version : null;

  let items = getLibraryMatches(store, query, version);
  if (items.length === 0 && version) {
    const fallback = normalizeVersionInput(version);
    if (fallback && fallback !== version) {
      items = getLibraryMatches(store, query, fallback);
    }
  }
  if (items.length === 0 && version) {
    const nameMatches = getLibraryMatches(store, query, null);
    if (nameMatches.length > 0) {
      const lines = [formatError(`no version match for ${version}`), "Try one of these version labels:"];
      const labels = Array.from(new Set(nameMatches.flatMap((item) => item.versions))).filter(Boolean);
      if (labels.length === 0) {
        lines.push("- none");
      } else {
        for (const label of labels.slice(0, 10)) {
          lines.push(`- ${label}`);
        }
        if (labels.length > 10) {
          lines.push(`- ... and ${labels.length - 10} more`);
        }
      }
      return { text: lines.join("\n"), isError: true };
    }
  }

  if (useJson) {
    return { text: JSON.stringify({ query, items }, null, 2), isError: false };
  }
  if (items.length === 0) {
    return { text: "No libraries found.", isError: false };
  }

  const lines: string[] = [];
  for (const item of items) {
    const versions = item.versions.length > 0 ? item.versions.join(", ") : "none";
    const ref = item.ref ? `ref: ${item.ref}, ` : "";
    lines.push(`- ${item.name} (${ref}versions: ${versions})`);
  }
  if (showTiming) {
    lines.push(`Time: ${Date.now() - startedAt} ms`);
  }
  return { text: lines.join("\n"), isError: false };
}

function normalizeVersionInput(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/i);
  if (!match) return null;
  const major = match[1];
  if (!major) return null;
  return `${major}.x`;
}
