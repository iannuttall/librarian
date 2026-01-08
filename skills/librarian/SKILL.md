---
name: librarian
description: Use Librarian to fetch and search up-to-date developer documentation from GitHub and websites so answers are grounded in real docs.
---

# Librarian skill

- Purpose: fetch and search developer docs on your machine so answers are based on real sources
- Best use: when you need accurate API details, code examples, or version‑specific docs
- Prereqs: Bun is required at runtime even if installed via npm/pnpm; install it if missing
- Check package manager: `command -v bun || command -v pnpm || command -v npm`
- Install (global): prefer npm by default, but use what exists
  - If `bun` exists: `bun add -g @iannuttall/librarian`
  - Else if `pnpm` exists: `pnpm add -g @iannuttall/librarian`
  - Else: `npm i -g @iannuttall/librarian`
- Install Bun (if missing): `curl -fsSL https://bun.sh/install | bash`
- Setup: run `librarian setup` and add tokens if you need private GitHub or gated models
- Verify: `librarian version`
- Add a repo: `librarian add owner/repo --docs docs --ref main`
- Add a site: `librarian add https://example.com/docs`
- Ingest: `librarian ingest --embed`
- Find a library first: `librarian library "nextjs"` or `librarian library --version 16.x "nextjs"`
- Search a library: `librarian search --library <name|id> "middleware"`
- Search modes: `--mode word|vector|hybrid` (word = exact words, vector = meaning, hybrid = both)
- Pin to a version: `librarian search --library <name|id> --version <label> "query"`
- Use detect for version labels: `librarian detect` then pass `--version <label>`
- Get a doc: `librarian get --library <name|id> docs/guide.md`
- Get a slice: `librarian get --library <name|id> --doc 12 --slice 5:40`
- Update: `librarian update` (auto-detects bun vs npm)
- Non‑interactive: add `--noprompt` where supported to avoid prompts
- Safety: do not paste secrets into prompts or docs
