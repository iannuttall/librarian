import { parseArgs } from "node:util";

export function parseFlags(args: string[]): Record<string, string> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      ref: { type: "string" },
      version: { type: "string" },
      docs: { type: "string" },
      source: { type: "string" },
      model: { type: "string" },
      "github-token": { type: "string" },
      embed: { type: "boolean" },
      force: { type: "boolean" },
      noprompt: { type: "boolean" },
      mode: { type: "string" },
      nameonly: { type: "boolean" },
      allow: { type: "string" },
      deny: { type: "string" },
      pages: { type: "string" },
      depth: { type: "string" },
      concurrency: { type: "string" },
      versionLabel: { type: "string" },
      format: { type: "string" },
      json: { type: "boolean" },
      timing: { type: "boolean" },
      include: { type: "string" },
      exclude: { type: "string" },
      doc: { type: "string" },
      slice: { type: "string" },
      tag: { type: "string" },
      "list-refs": { type: "boolean" },
      "refs-type": { type: "string" },
      "refs-limit": { type: "string" },
      "refs-filter": { type: "string" },
      "no-ingest": { type: "boolean" },
      "no-embed": { type: "boolean" },
    },
  });
  return parsed.values as Record<string, string>;
}
