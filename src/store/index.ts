export type { SourceRow, CrawlPageRow } from "./types";
export {
  addGithubSource,
  addWebSource,
  listSources,
  getSourceById,
  removeSource,
  updateSourceSync,
  updateSourceRef,
  updateSourceDbPath,
  addSourceVersion,
  listSourceVersions,
} from "./sources";
export { ensureLibraryDbPath, buildLibraryDbPath } from "./library-db";
export { upsertDocument, deactivateMissingDocuments, getDocumentByPathOrUri, getDocumentById } from "./documents";
export {
  insertChunks,
  deleteChunksForDocument,
  getChunksNeedingEmbedding,
  loadChunkForEmbedding,
  updateChunkTokenCount,
} from "./chunks";
export { markChunkEmbedded, insertEmbedding, clearAllEmbeddings } from "./embeddings";
export { searchFTS, searchVec } from "./search";
export { cleanupInactive } from "./maintenance";
export { getCrawlPage, getPendingCrawlPages, countCrawlPages, upsertCrawlPage, updateCrawlPageStatus, clearCrawlPages } from "./crawl";
