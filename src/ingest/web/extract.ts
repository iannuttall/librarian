import { load, type CheerioAPI } from "cheerio";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type { ExtractOptions, ExtractResult } from "./types";

const DEFAULTS = {
  mdMaxBytes: 5_000_000,
  mdMaxLines: 1000,
  minBodyChars: 400,
} as const;

export function extractFromHtml(
  html: string,
  url: string,
  options: ExtractOptions = {},
): ExtractResult {
  const opts = {
    mdMaxBytes: options.mdMaxBytes ?? DEFAULTS.mdMaxBytes,
    mdMaxLines: options.mdMaxLines ?? DEFAULTS.mdMaxLines,
    minBodyChars: options.minBodyChars ?? DEFAULTS.minBodyChars,
  };

  // Try readability first
  const viaReadability = extractViaReadability(html, url, opts);
  if (viaReadability && !viaReadability.isSparse) return viaReadability;

  // Fall back to turndown
  const viaTurndown = extractViaTurndown(html, url, opts);
  if (!viaTurndown.isSparse) return viaTurndown;

  // Return whichever has more content
  if (viaReadability && bodyTrimmedLength(viaReadability.markdown) > bodyTrimmedLength(viaTurndown.markdown)) {
    return viaReadability;
  }
  return viaTurndown;
}

function extractViaReadability(
  html: string,
  url: string,
  opts: Required<ExtractOptions>,
): ExtractResult | null {
  try {
    const { document } = parseHTML(html);
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();
    if (!article?.content) return null;

    const td = buildTurndown();
    let body = td.turndown(article.content);
    body = postProcessMarkdown(capMarkdown(body, opts));

    const title = normalizeTitle(article.title, url) ?? url;
    const description = sanitizeMetaValue(article.excerpt);

    if (shouldAddHeading(title, url) && !findFirstHeading(body)) {
      body = `# ${title}\n\n${body}`;
    }

    const markdown = body;
    const trimmedLength = bodyTrimmedLength(markdown);

    return {
      markdown,
      title,
      description,
      isSparse: trimmedLength < opts.minBodyChars,
    };
  } catch {
    return null;
  }
}

function extractViaTurndown(
  html: string,
  url: string,
  opts: Required<ExtractOptions>,
): ExtractResult {
  const $ = load(html);
  const $root = cleanAndSelect($);

  const rawTitle = $("title").first().text();
  const rawDescription = $('meta[name="description"]').attr("content");

  pruneInteractiveAndCustom($);
  whitelistStandardTags($);
  removeLinkHeavyAtEnds($);

  const td = buildTurndown();
  const innerHtml = $root.html() || "";
  let body = td.turndown(innerHtml);
  body = postProcessMarkdown(capMarkdown(body, opts));

  if (bodyTrimmedLength(body) < 200) {
    const simple = postProcessMarkdown(capMarkdown(htmlToMarkdownSimple(innerHtml), opts));
    if (bodyTrimmedLength(simple) > bodyTrimmedLength(body)) body = simple;
  }

  const title = normalizeTitle(rawTitle, url) ?? url;
  const description = sanitizeMetaValue(rawDescription);

  if (shouldAddHeading(title, url) && !findFirstHeading(body)) {
    body = `# ${title}\n\n${body}`;
  }

  const markdown = body;
  const trimmedLength = bodyTrimmedLength(markdown);

  return {
    markdown,
    title,
    description,
    isSparse: trimmedLength < opts.minBodyChars,
  };
}

function cleanAndSelect($: CheerioAPI) {
  $("script,style,nav,header,footer,aside,noscript").remove();
  $("[class*=navbar],[class*=sidebar],[class*=menu],[class*=toc],[class*=breadcrumb]").remove();

  let $root = $(".theme-doc-markdown").first();
  if (!$root.length) $root = $("main").first();
  if (!$root.length) $root = $("article").first();
  if (!$root.length) $root = $("body").first();
  return $root;
}

function pruneInteractiveAndCustom($: CheerioAPI): void {
  $("button,input,select,textarea,label,menu,canvas,form,iframe,dialog,template").remove();
  $("[role=toolbar],[role=navigation],[role=menu],[role=tablist]").remove();
  $("svg").remove();
  $("*").each((_i, el) => {
    const name = (el as { name?: string }).name ?? "";
    if (name.includes("-")) $(el).remove();
  });
}

function whitelistStandardTags($: CheerioAPI): void {
  const allowed = new Set([
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "div", "span",
    "ul", "ol", "li",
    "pre", "code",
    "blockquote", "br",
    "a", "em", "strong", "b", "i",
  ]);
  $("*").each((_i, el) => {
    const tag = ((el as { name?: string }).name ?? "").toLowerCase();
    if (!allowed.has(tag)) {
      $(el).replaceWith($(el).text());
    } else if (tag === "div" || tag === "span") {
      $(el).replaceWith($(el).contents());
    }
  });
}

function removeLinkHeavyAtEnds($: CheerioAPI): void {
  const children = $("body").children().toArray();
  const scoreAndMaybeRemove = (el: unknown) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (!text) return;
    const linkText = $el.find("a").text().trim();
    const ratio = text.length ? linkText.length / text.length : 0;
    const looksNav = /\b(log in|sign in|sign up|menu|search|home)\b/i.test(text);
    if ((ratio > 0.6 && text.length < 220) || looksNav) $el.remove();
  };
  for (const el of children.slice(0, 5)) scoreAndMaybeRemove(el);
  for (const el of children.slice(-5)) scoreAndMaybeRemove(el);
}

export function buildTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    bulletListMarker: "-",
  });

  td.addRule("stripImages", { filter: "img", replacement: () => "" });

  td.addRule("stripSvg", {
    filter: (node) => {
      const name = (node.nodeName || "").toLowerCase();
      return ["svg", "path", "circle", "rect", "line", "polyline", "polygon", "g"].includes(name);
    },
    replacement: () => "",
  });

  td.addRule("fencedCodeWithLang", {
    filter: (node) => {
      return node.nodeName === "PRE" && !!node.querySelector?.("code");
    },
    replacement: (_content, node) => {
      const codeEl = (node as Element).querySelector?.("code");
      const cls = codeEl?.getAttribute?.("class") || "";
      const m = /language-([a-z0-9+#-]+)/i.exec(cls);
      const lang = m ? m[1] : "";
      const inner = codeEl?.innerHTML || "";
      const code = inner.replace(/<[^>]+>/g, "");
      return `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
    },
  });

  return td;
}

function htmlToMarkdownSimple(html: string): string {
  let s = html;

  // Code blocks with language
  s = s.replace(/<pre[\s\S]*?><code[^>]*class="[^"]*?language-([a-z0-9+#-]+)[^"]*"[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_m, lang, inner) => `\n\`\`\`${lang}\n${inner.replace(/<[^>]+>/g, "")}\n\`\`\`\n`);

  // Code blocks without language
  s = s.replace(/<pre[\s\S]*?><code[\s\S]*?>([\s\S]*?)<\/code><\/pre>/gi,
    (_m, g1) => `\n\`\`\`\n${g1.replace(/<[^>]+>/g, "")}\n\`\`\`\n`);

  // Headings
  for (let i = 6; i >= 1; i--) {
    const re = new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, "gi");
    s = s.replace(re, (_m, g1) => `\n${"#".repeat(i)} ${g1.replace(/<[^>]+>/g, "").trim()}\n`);
  }

  // Paragraphs
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, g1) => `\n${g1.replace(/<[^>]+>/g, "").trim()}\n`);

  // List items
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, g1) => `- ${g1.replace(/<[^>]+>/g, "").trim()}\n`);

  // Inline code
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, g1) => `\`${g1.replace(/<[^>]+>/g, "").trim()}\``);

  // Links
  s = s.replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, g1) => {
    const text = g1.replace(/<[^>]+>/g, "").trim();
    return text ? `[${text}](${href})` : href;
  });

  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, "");

  // Decode entities
  s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  s = s.replace(/\r/g, "").replace(/\t/g, "  ").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function postProcessMarkdown(md: string): string {
  const lines = md.split("\n");
  while (lines.length > 0 && !lines[0]?.startsWith("#")) {
    const line = lines[0]?.trim() ?? "";
    const isLinkOnly = /^\[.+?\]\(.+?\)$/.test(line) || /^(\[.+?\]\(.+?\)\s*){1,3}$/.test(line);
    const isCta = /(log in|sign in|sign up|continue with)/i.test(line);
    if (line === "" || isLinkOnly || isCta) {
      lines.shift();
      continue;
    }
    break;
  }
  const cleaned = lines.filter((ln) => !/(continue with|sign up|sign in|log in)/i.test(ln));
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function capMarkdown(md: string, opts: { mdMaxBytes: number; mdMaxLines: number }): string {
  let result = md;
  if (Buffer.byteLength(result, "utf-8") > opts.mdMaxBytes) {
    result = result.slice(0, opts.mdMaxBytes);
  }
  const lines = result.split("\n");
  if (lines.length > opts.mdMaxLines) {
    result = lines.slice(0, opts.mdMaxLines).join("\n");
  }
  return result;
}

export function bodyTrimmedLength(content: string): number {
  const withoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/, "");
  const squeezed = withoutFrontmatter.replace(/\s+/g, "");
  return squeezed.length;
}

function sanitizeMetaValue(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\s+/g, " ");
}

function normalizeTitle(raw: string | null | undefined, url: string): string | undefined {
  if (!raw) return undefined;
  let title = raw.trim();
  if (!title) return undefined;

  const separators = [" - ", " · ", " | ", " — "];
  for (const sep of separators) {
    if (title.includes(sep)) {
      title = title.split(sep)[0]?.trim() ?? title;
      break;
    }
  }

  if (!title || title === url || /^https?:\/\//i.test(title)) return undefined;
  return title;
}

function shouldAddHeading(title: string | undefined, url: string): boolean {
  if (!title) return false;
  const trimmed = title.trim();
  if (!trimmed || trimmed === url || /^https?:\/\//i.test(trimmed)) return false;
  return true;
}

function findFirstHeading(md: string): string | null {
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (!line) continue;
    if (/^#{1,6}\s+/.test(line)) return line.replace(/^#{1,6}\s+/, "").trim();
    const next = lines[i + 1]?.trim();
    if (next === "===" || next === "---") return line;
  }
  return null;
}
