import { getChunksNeedingEmbedding, listSources, ensureLibraryDbPath } from "../store";
import { createLibraryStore } from "../store/db";
import { getDefaultEmbedModel } from "../llm/embed";
import type { Store } from "../store/db";
import { loadConfig } from "../core/config";
import { cleanupInactive } from "../store";
import { getCommandHintSync } from "./command-hint";

export async function cmdStatus(store: Store): Promise<void> {
  const config = loadConfig();
  const model = config.models?.embed ?? getDefaultEmbedModel();
  const sources = listSources(store.db);
  let needs = 0;
  let documents = 0;
  let chunks = 0;
  let embeddings = 0;
  for (const source of sources) {
    const libraryPath = ensureLibraryDbPath(store.db, source);
    const libraryStore = await createLibraryStore(libraryPath);
    try {
      needs += getChunksNeedingEmbedding(libraryStore.db, model).length;
      documents += (libraryStore.db.prepare("SELECT COUNT(*) as c FROM documents WHERE active = 1").get() as { c: number }).c;
      chunks += (libraryStore.db.prepare("SELECT COUNT(*) as c FROM chunks").get() as { c: number }).c;
      embeddings += (libraryStore.db.prepare("SELECT COUNT(*) as c FROM chunk_vectors").get() as { c: number }).c;
    } finally {
      libraryStore.close();
    }
  }
  const ingestRows = store.db
    .prepare("SELECT id, name, kind, ref, root_url, docs_path FROM sources WHERE last_sync_at IS NULL")
    .all() as Array<{
      id: number;
      name: string;
      kind: string;
      ref: string | null;
      root_url: string | null;
      docs_path: string | null;
    }>;
  const ingestNeeded = ingestRows.length;
  const counts = {
    sources: store.db.prepare("SELECT COUNT(*) as c FROM sources").get() as { c: number },
    documents: { c: documents },
    chunks: { c: chunks },
    embeddings: { c: embeddings },
  };
  const sourceSuffix = ingestNeeded > 0 ? ` (${ingestNeeded} need ingestion)` : "";
  console.log(`Sources: ${counts.sources.c}${sourceSuffix}`);
  console.log(`Documents: ${counts.documents.c}`);
  console.log(`Chunks: ${counts.chunks.c}`);
  console.log(`Embeddings: ${counts.embeddings.c}`);
  console.log(`Chunks needing embeddings: ${needs}`);
  if (ingestNeeded > 0) {
    console.log("Sources needing ingestion:");
    const shown = ingestRows.slice(0, 10);
    for (const row of shown) {
      const ref = row.ref ? `@${row.ref}` : "";
      const extra = row.root_url ? row.root_url : row.docs_path ? row.docs_path : "";
      const extraLabel = extra ? ` ${extra}` : "";
      console.log(`- ${row.id}. ${row.name} (${row.kind}) ${ref}${extraLabel}`.trim());
    }
    if (ingestRows.length > shown.length) {
      console.log(`- ... and ${ingestRows.length - shown.length} more`);
    }
    console.log(`Run ${getCommandHintSync()} ingest to fetch them.`);
  }
  if (needs === 0) {
    console.log("Embedding search is ready.");
  } else {
    console.log(`Run ${getCommandHintSync()} embed to make them.`);
  }
}

export async function cmdCleanup(store: Store): Promise<void> {
  const sources = listSources(store.db);
  let removedDocs = 0;
  let removedChunks = 0;
  let removedVectors = 0;
  let removedBlobs = 0;
  for (const source of sources) {
    const libraryPath = ensureLibraryDbPath(store.db, source);
    const libraryStore = await createLibraryStore(libraryPath);
    try {
      const result = cleanupInactive(libraryStore.db);
      removedDocs += result.documents;
      removedChunks += result.chunks;
      removedVectors += result.vectors;
      removedBlobs += result.blobs;
    } finally {
      libraryStore.close();
    }
  }
  console.log(`Removed documents: ${removedDocs}`);
  console.log(`Removed chunks: ${removedChunks}`);
  console.log(`Removed vectors: ${removedVectors}`);
  console.log(`Removed blobs: ${removedBlobs}`);
}
