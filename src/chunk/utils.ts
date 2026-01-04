export function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function buildPreview(text: string, limit: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, Math.max(0, limit - 3))}...`;
}

export function clampText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd();
}

export function wrapCodeFence(code: string, language?: string | null): string {
  const label = language ? language : "";
  return `\`\`\`${label}\n${code.trimEnd()}\n\`\`\``;
}

export function buildBreadcrumb(segments: Array<string | null | undefined>): string {
  const filtered: string[] = [];
  for (const segment of segments) {
    const trimmed = String(segment ?? "").trim();
    if (!trimmed) continue;
    if (filtered.length === 0 || filtered[filtered.length - 1] !== trimmed) {
      filtered.push(trimmed);
    }
  }
  return filtered.join(" > ");
}

export function containsCodeSnippet(content: string): boolean {
  if (content.includes("```") || content.includes("~~~")) return true;
  if (/^(?:[ ]{4}|\t).+/m.test(content)) return true;
  if (/<(pre|code)[\s>]/i.test(content)) return true;
  return false;
}
