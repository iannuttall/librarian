import {
  getLlama,
  LlamaChatSession,
  LlamaLogLevel,
  resolveModelFile,
  type Llama,
  type LlamaModel,
} from "node-llama-cpp";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const DEFAULT_QUERY_MODEL = "hf:Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf";
const MODEL_CACHE_DIR = join(homedir(), ".cache", "librarian", "models");

let llamaInstance: Llama | null = null;
let queryModel: LlamaModel | null = null;
let queryModelUri = DEFAULT_QUERY_MODEL;

export function getDefaultQueryModel(): string {
  return queryModelUri;
}

export function setDefaultQueryModel(uri: string): void {
  queryModelUri = uri;
}

export async function resolveQueryModel(uri: string, download: "auto" | false = "auto"): Promise<string> {
  ensureModelCacheDir();
  return resolveModelFile(uri, { directory: MODEL_CACHE_DIR, download, headers: getModelHeaders() });
}

export async function tryResolveQueryModel(uri?: string): Promise<string | null> {
  const target = uri ?? queryModelUri;
  try {
    return await resolveQueryModel(target, false);
  } catch {
    return null;
  }
}

export async function ensureQueryModel(uri?: string): Promise<string> {
  const target = uri ?? queryModelUri;
  return resolveQueryModel(target, "auto");
}

export async function expandQuery(query: string, count = 2, uri?: string): Promise<string[]> {
  const model = await ensureModel(uri ?? queryModelUri);
  const context = await model.createContext();
  const sequence = context.getSequence();
  const session = new LlamaChatSession({ contextSequence: sequence });

  const prompt = `You are a search query expander. Given a search query, generate ${count} alternative queries that would help find relevant documents.

Rules:
- Use synonyms and related terms
- Keep proper nouns exactly as written
- Each variation should be 3-8 words, natural search terms
- Do NOT add words like "search" or "find"

Query: "${query}"

Output exactly ${count} variations, one per line, no numbering or bullets:`;

  let text = "";
  try {
    await session.prompt(prompt, {
      maxTokens: 150,
      temperature: 0,
      onTextChunk: (chunk) => {
        text += chunk;
      },
    });
  } finally {
    await context.dispose();
  }

  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 2 && line.length < 120)
    .filter((line) => !line.startsWith("-") && !line.startsWith("*"));

  const deduped: string[] = [];
  for (const line of lines) {
    if (line.toLowerCase() === query.toLowerCase()) continue;
    if (!deduped.some((item) => item.toLowerCase() === line.toLowerCase())) {
      deduped.push(line);
    }
  }

  return deduped.slice(0, count);
}

async function ensureModel(uri: string): Promise<LlamaModel> {
  if (queryModel) return queryModel;
  const llama = await ensureLlama();
  const modelPath = await resolveQueryModel(uri, "auto");
  queryModel = await llama.loadModel({ modelPath });
  return queryModel;
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
