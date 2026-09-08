# postrun

Session review framework for AI coding agents. Real captures on disk become schema-typed steps, which a localhost server exposes to a browser timeline.

## Layout

pnpm workspace with two packages:

- `core/` (`@postrun/core`): the logic. Schema types, per-agent adapters, the localhost-only server, and the future capture and AI seams. No UI code.
- `ui/` (`@postrun/ui`): the design. Next.js (App Router, TypeScript) session timeline. Imports types from `@postrun/core`, never runtime code.
- `docs/`: schema drafts, pressure test, and handoffs.

## Setup

```bash
pnpm install
```

## Commands (from the repo root)

```bash
pnpm ingest --agent claude-code ~/.postrun/captures   # normalize and store a Claude Code capture
pnpm ingest --agent cline <session-id>                # normalize and store a Cline session (~/.cline/data/sessions)
pnpm sessions                    # list stored sessions, newest first (--agent <kind> to filter)
pnpm serve                       # build the UI, then serve the store at http://127.0.0.1:1234/
pnpm dev:core                    # core server only (API + last built UI) on 127.0.0.1:1234
pnpm dev:ui                      # Next dev on 127.0.0.1:3000 (UI_PORT to change), /api proxied to the core server on 1234
pnpm adapter:cc ~/.postrun/captures > steps.json   # Claude Code captures -> Step[] JSON (no store)
pnpm adapter:cline <session-id> > steps.json       # Cline session -> Step[] JSON (no store)
pnpm typecheck                   # both packages
pnpm test                        # both packages
pnpm build                       # both packages
```

Sessions are stored in `~/.postrun/postrun.db` (SQLite, override with `POSTRUN_DB` or `--db`). The server reads the store; it never runs adapters. Port precedence: `--port` flag, then `PORT` env, then 1234. It binds to 127.0.0.1 only.

```bash
pnpm serve --port 4321
pnpm serve --db /some/other/postrun.db
```

## Environment

**IMPORTANT**: No secrets or credentials ever go in this repository. All `.env` files are in `.gitignore` and must be created locally with secret values only. Never commit API keys, passwords, or authentication tokens of any kind.

## Architecture

See `core/README.md`, `ui/README.md`, and the README in each `core/src/*` subdirectory.
