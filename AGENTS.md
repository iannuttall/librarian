# AGENTS.md

Librarian agent notes:
- Librarian is local-first and uses your local database; prefer search + get over guessing.
- Use `librarian search --library <name|id>` with `--mode word|vector|hybrid` and `--version` when you need version‑specific answers.
- Use `librarian library` to find a repo and see its current ref and version labels.
- Use `librarian detect` in a repo to get the version label for that codebase, then pass it to `librarian search --version <label>` to avoid mixed results. If you are not in a repo, run a library search first: `librarian library "<name>"`.
- Use `librarian get --library <name|id> --doc <id> --slice a:b` to fetch small, precise excerpts.
- Avoid prompts for automation: add `--noprompt` where supported.
- Tokens live in `~/.config/librarian/config.yml`; do not print or log them.
- MCP server is read‑only: tools are `search`, `library`, and `get`.
- Local data lives in `~/.cache/librarian/index.sqlite` plus per‑library DBs in `~/.cache/librarian/db/` (override with `LIBRARIAN_DB_PATH` or `LIBRARIAN_LIBRARY_DB_DIR`).
- Tests: run `bun test` (some headless Chrome tests are skipped unless configured).
- If you change CLI output, keep errors as red “Error: …” plus a command‑specific help block.
- Commits: Use conventional commits (feat|fix|refactor|build|ci|chore|docs|style|perf|test).
