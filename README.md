# Librarian

Librarian fetches and searches up-to-date developer docs on your machine.  
Use it to give AI agents real context so they stop guessing and writing bad code.

Supports GitHub repos and public websites.

## Quick start

```bash
bun install
```

```bash
bun setup
```

If you choose the global install during setup, use `librarian` below.  
Otherwise use `./librarian`.

```bash
librarian add https://github.com/honojs/website --docs docs
```

```bash
librarian add https://hono.dev/docs
```

```bash
librarian ingest --embed
```

```bash
librarian library "honojs"
```

```bash
librarian search --library honojs/website "middleware"
```

## Sources

### GitHub repos
```bash
librarian add https://github.com/owner/repo --docs docs --ref main
librarian add https://github.com/owner/repo --version 16.x
```

### Websites
```bash
# Basic - auto-discovers via llms.txt, sitemap.xml, robots.txt
librarian add https://docs.example.com

# With options
librarian add https://docs.example.com/api --depth 3 --pages 500

# Specific paths
librarian add https://example.com --allow /docs,/api --deny /blog
```

## Ingest

```bash
# Ingest all sources
librarian ingest

# Ingest with concurrency (default: 5)
librarian ingest --concurrency 10

# Force re-ingest
librarian ingest --force

# Ingest and embed
librarian ingest --embed
```

## Seed sources

```bash
# Add the built-in seed list and auto-ingest
librarian seed
```

The default seed list lives in `data/libraries.yml` in this repo.

## Search

```bash
# Hybrid search (word + meaning)
librarian search --library vercel/next.js "middleware"

# Word search only
librarian search --library vercel/next.js --mode word "middleware"

# Meaning search only
librarian search --library vercel/next.js --mode vector "middleware"

# JSON output
librarian search --library vercel/next.js --json "middleware"

# Filter by version
librarian search --library vercel/next.js --version 16.x "middleware"
```

To avoid mixed results, scope searches to a library version label. If you are in a repo, run:
```bash
librarian detect
```
Then pass the label to search. If you are not in a repo, run a library search first: `librarian library "<name>"` to see the available version labels.

## Library search

```bash
# Find a library and list versions
librarian library "nextjs"
```

## Other commands

```bash
librarian source list          # List sources
librarian source remove 1      # Remove source
librarian seed                 # Add sources from the seed list
librarian get --library vercel/next.js docs/guide.md          # Read a doc
librarian get --library vercel/next.js --doc 69 --slice 19:73 # Read a slice
librarian status               # Show counts
librarian detect               # Detect versions in cwd
librarian cleanup              # Remove inactive docs
```

## MCP server

```bash
# Start the MCP server (stdio)
librarian mcp
```

Tools:
- search (use `mode` for word/vector/hybrid)
- library
- get

## Configuration

Config file: `~/.config/librarian/config.yml`

```yaml
github:
  token: ghp_xxx  # For private repos

proxy:
  endpoint: http://user:pass@proxy.example.com:8080
  # Any HTTP proxy works; tested with Webshare.

headless:
  enabled: true
  proxy: http://proxy.example.com:9999  # IP-whitelisted, no auth
  chromePath: /path/to/chrome  # Optional, auto-detected

crawl:
  concurrency: 5

ingest:
  maxMajorVersions: 3
```

## Notes
- `setup` downloads the local embedding model
- Public repos don't need a GitHub token
- Website crawling auto-detects CSR/SPA sites and uses headless Chrome
- Chrome is auto-detected but can be configured manually
- Run `librarian setup` to check Chrome availability
- If `librarian` does not work, use `./librarian`
- More examples in `docs/usage.md`

## Agent skills
Skills use progressive disclosure, so only the skill name and description load at startup.

### Codex
- Copy the bundled skill to your Codex skills folder:

```bash
mkdir -p ~/.codex/skills
cp -R skills/librarian ~/.codex/skills/librarian
```

- Direct invocation works in Codex CLI: use `$librarian` or `/skills`
- Codex web and iOS do not support direct invocation yet, so just ask to use the librarian skill

### Claude Code
- Copy the skill to your Claude Code skills folder:

```bash
mkdir -p ~/.claude/skills
cp -R skills/librarian ~/.claude/skills/librarian
```

### Factory
- Copy the skill to your Factory skills folder:

```bash
mkdir -p ~/.factory/skills
cp -R skills/librarian ~/.factory/skills/librarian
```
