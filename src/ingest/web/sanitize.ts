export function sanitizeMarkdown(input: string): string {
  let content = input;

  // Remove anchor-only links
  content = content.replace(/<a\s+(?:name|id)=["\'][^"\']+["\']\s*><\/a>/gi, "");
  content = content.replace(/<a\s+[^>]*>(.*?)<\/a>/gis, "$1");

  content = removeNamedToc(content);
  content = removeAnchorLists(content);
  content = stripMarkdownLinks(content);
  content = removeWbrTags(content);
  content = stripHtmlTags(content);
  content = fixBadUnicode(content);
  content = unescapeUnderscoresInCode(content);
  content = decodeEscapedNewlines(content);
  content = collapseBlankLines(content);
  content = convertSetextHeadings(content);

  return content.trim();
}

export function hasCodeSnippets(content: string | null | undefined): boolean {
  if (!content?.trim()) return false;

  // Fenced code blocks
  if (/```[\s\S]*?```/m.test(content)) return true;
  if (/~~~[\s\S]*?~~~/m.test(content)) return true;

  // Inline code
  return /`[^`]+`/.test(content);
}

export function bodyLength(content: string): number {
  const withoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/, "");
  const squeezed = withoutFrontmatter.replace(/\s+/g, "");
  return squeezed.length;
}

function removeNamedToc(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const result: string[] = [];
  let skippingToc = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!skippingToc && /^#{1,6}\s+(?:table of contents|contents|on this page)\s*$/i.test(trimmed)) {
      skippingToc = true;
      continue;
    }

    if (skippingToc) {
      if (trimmed === "" || /^\s*[-*+]\s+\[[^\]]+]\(#.*\)\s*$/i.test(line)) {
        continue;
      }
      if (/^#{1,6}\s+/.test(trimmed)) {
        skippingToc = false;
        result.push(line);
        continue;
      }
      skippingToc = false;
    }

    result.push(line);
  }

  return result.join("\n");
}

function removeAnchorLists(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  return lines.filter((line) => !/^\s*[-*+]\s+\[[^\]]+]\(#.*\)\s*$/i.test(line)).join("\n");
}

function stripMarkdownLinks(markdown: string): string {
  let content = markdown;
  // Images
  content = content.replace(/!\[([^\]]*?)\]\(([^)]+)\)/g, "$1");
  // Links - keep text with URL in parens
  content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
    return `${text.trim()} (${url})`;
  });
  return content;
}

function decodeEscapedNewlines(markdown: string): string {
  return markdown.replace(/\\r\\n|\\n/g, "\n");
}

function collapseBlankLines(markdown: string): string {
  return markdown.replace(/\n{3,}/g, "\n\n");
}

function convertSetextHeadings(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const next = lines[i + 1];
    const trimmedNext = next?.trim();

    if (next !== undefined && /^={3,}$/.test(trimmedNext ?? "")) {
      result.push(`# ${line.trim()}`);
      i++;
      continue;
    }

    if (next !== undefined && /^-{3,}$/.test(trimmedNext ?? "")) {
      result.push(`## ${line.trim()}`);
      i++;
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
}

function removeWbrTags(markdown: string): string {
  return markdown.replace(/<\/?wbr\s*\/?>/gi, "");
}

function fixBadUnicode(markdown: string): string {
  const replacements: Record<string, string> = {
    "\u00E2\u0080\u0099": "\u2019", // '
    "\u00E2\u0080\u0098": "\u2018", // '
    "\u00E2\u0080\u009C": "\u201C", // "
    "\u00E2\u0080\u009D": "\u201D", // "
    "\u00E2\u0080\u0093": "\u2013", // –
    "\u00E2\u0080\u0094": "\u2014", // —
    "\u00E2\u0080\u00A6": "\u2026", // …
    "\u00C2\u00A0": " ",
  };

  let result = markdown;
  for (const [bad, good] of Object.entries(replacements)) {
    result = result.split(bad).join(good);
  }
  return result;
}

function unescapeUnderscoresInCode(markdown: string): string {
  const blocks: Record<string, string> = {};
  let content = markdown.replace(/(```|~~~)[\s\S]*?\1/gm, (match) => {
    const key = `___CODE_BLOCK_${Object.keys(blocks).length}___`;
    blocks[key] = match.replace(/\\_/g, "_");
    return key;
  });

  content = content.replace(/`[^`]+`/g, (match) => match.replace(/\\_/g, "_"));

  for (const [key, block] of Object.entries(blocks)) {
    content = content.replace(key, block);
  }

  return content;
}

function stripHtmlTags(markdown: string): string {
  const placeholders: Record<string, string> = {};
  let content = markdown.replace(/```[\s\S]*?```/g, (match) => {
    const key = `___CODE_FENCE_${Object.keys(placeholders).length}___`;
    placeholders[key] = match;
    return key;
  });

  // Strip style and script tags
  content = content.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  content = content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  // Restore code fences
  for (const [key, code] of Object.entries(placeholders)) {
    content = content.replace(key, code);
  }

  return content;
}
