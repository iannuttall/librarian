import { describe, expect, test } from "bun:test";
import { extractFromHtml, bodyTrimmedLength } from "../src/ingest/web/extract";
import { sanitizeMarkdown, hasCodeSnippets, bodyLength } from "../src/ingest/web/sanitize";

describe("html extraction", () => {
  test("extracts markdown from simple html", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Test Page</title></head>
        <body>
          <h1>Hello World</h1>
          <p>This is a test paragraph with some <code>inline code</code>.</p>
          <pre><code class="language-javascript">console.log('hello');</code></pre>
        </body>
      </html>
    `;

    const result = extractFromHtml(html, "https://example.com/test", { minBodyChars: 50 });

    expect(result.title).toBe("Test Page");
    expect(result.markdown).toContain("Hello World");
    expect(result.markdown).toContain("inline code");
    expect(result.markdown).toContain("```");
    expect(result.markdown).toContain("console.log");
    expect(result.isSparse).toBe(false);
  });

  test("handles page with no content gracefully", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Empty Page</title></head>
        <body></body>
      </html>
    `;

    const result = extractFromHtml(html, "https://example.com/empty", { minBodyChars: 100 });
    // Empty body will have minimal content from title
    expect(result.markdown.length).toBeLessThan(50);
  });

  test("strips navigation and footer elements", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Doc Page</title></head>
        <body>
          <nav>Navigation links here</nav>
          <header>Header content</header>
          <main>
            <h1>Main Content</h1>
            <p>This is the main documentation content with \`code\` examples.</p>
          </main>
          <footer>Footer content</footer>
        </body>
      </html>
    `;

    const result = extractFromHtml(html, "https://example.com/doc");

    expect(result.markdown).toContain("Main Content");
    expect(result.markdown).not.toContain("Navigation links");
    expect(result.markdown).not.toContain("Footer content");
  });

  test("extracts code blocks with language", () => {
    const html = `
      <html>
        <head><title>Code Example</title></head>
        <body>
          <h1>Code Examples</h1>
          <pre><code class="language-typescript">
const greeting: string = "hello";
console.log(greeting);
          </code></pre>
          <pre><code class="language-python">
def greet():
    print("hello")
          </code></pre>
        </body>
      </html>
    `;

    const result = extractFromHtml(html, "https://example.com/code");

    expect(result.markdown).toContain("```typescript");
    expect(result.markdown).toContain("```python");
    expect(result.markdown).toContain("const greeting");
    expect(result.markdown).toContain("def greet");
  });
});

describe("markdown sanitization", () => {
  test("removes table of contents", () => {
    const md = `
# Documentation

## Table of Contents
- [Section 1](#section-1)
- [Section 2](#section-2)

## Section 1
Content here.

## Section 2
More content.
    `;

    const result = sanitizeMarkdown(md);

    expect(result).toContain("Section 1");
    expect(result).toContain("Content here");
    expect(result).not.toContain("[Section 1](#section-1)");
  });

  test("preserves code blocks", () => {
    const md = `
# Example

\`\`\`javascript
const x = 1;
const y = 2;
\`\`\`

More text.
    `;

    const result = sanitizeMarkdown(md);

    expect(result).toContain("```javascript");
    expect(result).toContain("const x = 1");
  });

  test("converts setext headings to atx", () => {
    const md = `
Title Here
==========

Subtitle
--------

Content.
    `;

    const result = sanitizeMarkdown(md);

    expect(result).toContain("# Title Here");
    expect(result).toContain("## Subtitle");
    expect(result).not.toContain("===");
    expect(result).not.toContain("---");
  });

  test("collapses multiple blank lines", () => {
    const md = `
# Title



Content here.




More content.
    `;

    const result = sanitizeMarkdown(md);
    const blankLineCount = (result.match(/\n\n\n/g) || []).length;

    expect(blankLineCount).toBe(0);
  });
});

describe("code snippet detection", () => {
  test("detects fenced code blocks", () => {
    const md = `
# Example

\`\`\`javascript
console.log("hello");
\`\`\`
    `;

    expect(hasCodeSnippets(md)).toBe(true);
  });

  test("detects tilde fenced code blocks", () => {
    const md = `
~~~python
print("hello")
~~~
    `;

    expect(hasCodeSnippets(md)).toBe(true);
  });

  test("detects inline code", () => {
    const md = "Use the \`console.log()\` function.";

    expect(hasCodeSnippets(md)).toBe(true);
  });

  test("returns false for plain text", () => {
    const md = "This is just plain text without any code.";

    expect(hasCodeSnippets(md)).toBe(false);
  });
});

describe("body length calculation", () => {
  test("calculates trimmed length", () => {
    const content = "  Hello   World  \n\n  Test  ";
    const length = bodyLength(content);

    // Should strip whitespace: "HelloWorldTest" = 14
    expect(length).toBe(14);
  });

  test("excludes frontmatter", () => {
    const content = `---
title: Test
description: A test
---

# Hello

Content here.
    `;

    const length = bodyLength(content);
    const withoutFrontmatter = bodyLength("# Hello\n\nContent here.");

    expect(length).toBe(withoutFrontmatter);
  });

  test("bodyTrimmedLength matches bodyLength", () => {
    const content = "Some test content with spaces";

    expect(bodyTrimmedLength(content)).toBe(bodyLength(content));
  });
});
