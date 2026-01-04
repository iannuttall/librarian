import { getLlama, resolveModelFile, LlamaLogLevel, type Llama, type LlamaModel, type LlamaEmbeddingContext } from "node-llama-cpp";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const DEFAULT_EMBED_MODEL = "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";
const MODEL_CACHE_DIR = join(homedir(), ".cache", "librarian", "models");

let llamaInstance: Llama | null = null;
let embedModel: LlamaModel | null = null;
let embedContext: LlamaEmbeddingContext | null = null;
let modelUri = DEFAULT_EMBED_MODEL;

export function formatQueryForEmbedding(query: string): string {
  return `task: search result | query: ${query}`;
}

export function formatDocForEmbedding(text: string, title?: string): string {
  return `title: ${title || "none"} | text: ${text}`;
}

export function getDefaultEmbedModel(): string {
  return modelUri;
}

export function setDefaultEmbedModel(uri: string): void {
  modelUri = uri;
}

export async function ensureEmbeddingModel(uri?: string): Promise<string> {
  const target = uri ?? modelUri;
  return resolveEmbeddingModel(target, "auto");
}

export async function resolveEmbeddingModel(uri: string, download: "auto" | false = "auto"): Promise<string> {
  ensureModelCacheDir();
  return resolveModelFile(uri, { directory: MODEL_CACHE_DIR, download, headers: getModelHeaders() });
}

export async function tryResolveEmbeddingModel(uri?: string): Promise<string | null> {
  const target = uri ?? modelUri;
  try {
    return await resolveEmbeddingModel(target, false);
  } catch {
    return null;
  }
}

export type EmbeddingUsage = {
  tokenCount: number;
  originalTokenCount: number;
  wasClamped: boolean;
};

export async function embedText(
  text: string,
  input?: { model?: string; usage?: EmbeddingUsage },
): Promise<Float32Array> {
  const context = await ensureEmbedContext(input?.model ?? modelUri);
  const safe = clampEmbeddingInput(text, context);
  if (input?.usage) {
    input.usage.tokenCount = safe.tokenCount;
    input.usage.originalTokenCount = safe.originalTokenCount;
    input.usage.wasClamped = safe.wasClamped;
  }
  const safeText = safe.text;
  const embedding = await context.getEmbeddingFor(safeText);
  const vector = embedding.vector as Float32Array | number[];
  if (vector instanceof Float32Array) return vector;
  if (Array.isArray(vector)) return Float32Array.from(vector);
  return new Float32Array(vector as ArrayLike<number>);
}

export async function tryEmbedText(text: string, input?: { model?: string }): Promise<Float32Array | null> {
  try {
    return await embedText(text, input);
  } catch {
    return null;
  }
}

async function ensureEmbedContext(uri: string): Promise<LlamaEmbeddingContext> {
  if (!embedContext) {
    const model = await ensureEmbedModel(uri);
    embedContext = await model.createEmbeddingContext();
  }
  return embedContext;
}

async function ensureEmbedModel(uri: string): Promise<LlamaModel> {
  if (embedModel) return embedModel;
  const llama = await ensureLlama();
  const modelPath = await resolveModelFile(uri, MODEL_CACHE_DIR);
  embedModel = await llama.loadModel({ modelPath });
  return embedModel;
}

async function ensureLlama(): Promise<Llama> {
  if (!llamaInstance) {
    llamaInstance = await getLlama({ logLevel: LlamaLogLevel.error });
  }
  return llamaInstance;
}

function ensureModelCacheDir(): void {
  if (!existsSync(MODEL_CACHE_DIR)) {
    mkdirSync(MODEL_CACHE_DIR, { recursive: true });
  }
}

function getModelHeaders(): Record<string, string> | undefined {
  const token = process.env.LIBRARIAN_HF_TOKEN || process.env.HUGGINGFACE_TOKEN;
  if (!token) return undefined;
  return { Authorization: `Bearer ${token}` };
}

function clampEmbeddingInput(
  text: string,
  context: LlamaEmbeddingContext,
): { text: string; tokenCount: number; originalTokenCount: number; wasClamped: boolean } {
  const max = getEmbeddingContextSize(context);
  const limit = Math.max(16, max - 2);
  const tokens = context.model.tokenize(text, true, "trimLeadingSpace");
  if (tokens.length <= limit) {
    return { text, tokenCount: tokens.length, originalTokenCount: tokens.length, wasClamped: false };
  }
  const trimmed = tokens.slice(0, limit);
  const safeText = context.model.detokenize(trimmed, true);
  return { text: safeText, tokenCount: trimmed.length, originalTokenCount: tokens.length, wasClamped: true };
}

function getEmbeddingContextSize(context: LlamaEmbeddingContext): number {
  const raw = (context as unknown as { _llamaContext?: { contextSize?: number } })._llamaContext;
  if (raw?.contextSize && Number.isFinite(raw.contextSize)) return raw.contextSize;
  if (context.model.trainContextSize && Number.isFinite(context.model.trainContextSize)) {
    return context.model.trainContextSize;
  }
  return 512;
}
