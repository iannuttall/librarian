import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { createStore } from "./store/db";
import { runSearch } from "./services/search-run";
import { runGet } from "./services/get-run";
import { runLibrary } from "./services/library-run";

const TOOL_LIST = [
  {
    name: "search",
    description: "Use this tool to search local coding documentation and examples for a specific library. Set mode to word, vector, or hybrid, and use version to limit results to a specific label.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        library: { type: "string" },
        mode: { type: "string", enum: ["word", "vector", "hybrid"] },
        version: { type: "string" },
        json: { type: "boolean" },
        timing: { type: "boolean" },
      },
      required: ["query", "library"],
    },
  },
  {
    name: "get",
    description: "Use this tool to fetch a full document or a small slice by line range for a specific library. Provide docId or a path/uri, and use slice as start:end for a focused excerpt.",
    inputSchema: {
      type: "object",
      properties: {
        library: { type: "string" },
        pathOrUri: { type: "string" },
        docId: { type: "number" },
        slice: { type: "string" },
      },
      required: ["library"],
    },
  },
  {
    name: "library",
    description: "Use this tool to find a library name and see which version labels are available in your local docs. Use the results as the library input for search or get, and set version to filter the list.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        version: { type: "string" },
        json: { type: "boolean" },
        timing: { type: "boolean" },
      },
      required: ["query"],
    },
  },
];

export async function runMcpServer(): Promise<void> {
  const server = new Server(
    { name: "librarian", version: "0.1.5" },
    { capabilities: { tools: {} } },
  );
  const store = await createStore();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_LIST }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const params = asRecord(request.params.arguments);

    try {
      switch (toolName) {
        case "search": {
          const result = await runSearch(store, {
            query: getString(params, "query"),
            library: getString(params, "library"),
            mode: getString(params, "mode"),
            version: getString(params, "version"),
            json: getBoolean(params, "json"),
            timing: getBoolean(params, "timing"),
          });
          return { content: [{ type: "text", text: result.text }], isError: result.isError };
        }
        case "get": {
          const result = await runGet(store, {
            library: getString(params, "library"),
            pathOrUri: getString(params, "pathOrUri"),
            docId: getNumber(params, "docId"),
            slice: getString(params, "slice"),
          });
          return { content: [{ type: "text", text: result.text }], isError: result.isError };
        }
        case "library": {
          const result = runLibrary(store, {
            query: getString(params, "query"),
            version: getString(params, "version"),
            json: getBoolean(params, "json"),
            timing: getBoolean(params, "timing"),
          });
          return { content: [{ type: "text", text: result.text }], isError: result.isError };
        }
        default:
          return { content: [{ type: "text", text: "Unknown tool." }], isError: true };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    store.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) {
  runMcpServer();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

function getBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key];
  return typeof value === "boolean" ? value : undefined;
}

function getNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === "number" ? value : undefined;
}
