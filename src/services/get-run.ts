import type { Store } from "../store/db";
import { createLibraryStore } from "../store/db";
import { ensureLibraryDbPath, getDocumentById, getDocumentByPathOrUri, listSources } from "../store";
import { resolveLibrary } from "../cli/library-resolve";
import { formatError, formatGetHelp } from "../cli/help";
import { sliceDocument } from "./document-slice";

export type GetRunInput = {
  library: string | null | undefined;
  pathOrUri: string | null | undefined;
  docId: number | string | null | undefined;
  slice: string | null | undefined;
};

export type GetRunResult = {
  text: string;
  isError: boolean;
};

export async function runGet(store: Store, input: GetRunInput): Promise<GetRunResult> {
  const target = (input.pathOrUri ?? "").trim();
  const rawDocId = input.docId;
  const docId = typeof rawDocId === "number"
    ? rawDocId
    : typeof rawDocId === "string" && rawDocId.trim() !== ""
      ? Number(rawDocId)
      : null;
  const sliceParam = typeof input.slice === "string" ? input.slice : null;
  const libraryValue = typeof input.library === "string" ? input.library : null;

  if (!target && !docId) {
    return {
      text: `${formatError("you need to provide a path, URL, or document id")}\n${formatGetHelp()}`,
      isError: true,
    };
  }

  const resolved = resolveLibraryForGet(store, libraryValue, target);
  if (!resolved) {
    return {
      text: `${formatError("you need to provide a library")}\n${formatGetHelp()}`,
      isError: true,
    };
  }

  const libraryPath = ensureLibraryDbPath(store.db, resolved);
  const libraryStore = await createLibraryStore(libraryPath);
  try {
    if (docId) {
      const doc = getDocumentById(libraryStore.db, docId);
      if (!doc) {
        return { text: "Document not found.", isError: false };
      }
      try {
        const payload = sliceParam ? sliceDocument(doc.content, sliceParam) : doc.content;
        return { text: payload, isError: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { text: `${formatError(message)}\n${formatGetHelp()}`, isError: true };
      }
    }

    const doc = getDocumentByPathOrUri(libraryStore.db, target);
    if (!doc) {
      return { text: "Document not found.", isError: false };
    }
    try {
      const payload = sliceParam ? sliceDocument(doc.content, sliceParam) : doc.content;
      return { text: payload, isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { text: `${formatError(message)}\n${formatGetHelp()}`, isError: true };
    }
  } finally {
    libraryStore.close();
  }
}

function resolveLibraryForGet(
  store: Store,
  libraryInput: string | null,
  target: string,
): ReturnType<typeof resolveLibrary>["source"] {
  if (libraryInput) {
    return resolveLibrary(store.db, libraryInput).source;
  }
  if (target.startsWith("gh://")) {
    const match = target.replace("gh://", "").split("/")[0] ?? "";
    const ownerRepo = match.split("@")[0] ?? match;
    if (ownerRepo.includes("/")) {
      return resolveLibrary(store.db, ownerRepo).source;
    }
  }
  if (target.startsWith("http://") || target.startsWith("https://")) {
    const sources = listSources(store.db);
    const hit = sources.find((source) => source.root_url && target.startsWith(source.root_url));
    if (hit) return hit;
  }
  return null;
}
