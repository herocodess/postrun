# postrun

Session review framework for AI coding agents. Real captures on disk become schema-typed steps, which a localhost server exposes to a browser timeline.

## Layout

pnpm workspace with three packages:

- `core/` (`@postrun/core`): the logic. Schema types, per-agent adapters, the localhost-only server, and the future capture and AI seams. No UI code.
- `ui/` (`@postrun/ui`): the design. Next.js (App Router, TypeScript) session timeline. Imports types from `@postrun/core`, never runtime code.
- `apps/web` (`@postrun/web`): the postrun.app marketing site, a static Next.js export. See `apps/web/README.md`.
- `docs/`: schema drafts, pressure test, handoffs, and decisions.

## Setup

```bash
pnpm install
```

## Commands (from the repo root)

```bash
pnpm ingest --agent claude-code ~/.postrun/captures   # normalize and store a Claude Code capture
pnpm ingest --agent cline <session-id>                # normalize and store a Cline session (~/.cline/data/sessions)
pnpm sessions                    # list stored sessions, newest first (--agent <kind> to filter)
pnpm export <session-id>         # write one redacted, self-contained HTML report to share (-o <file>)
pnpm serve                       # build the UI, then serve the store at http://127.0.0.1:1234/
pnpm dev:core                    # core server only (API + last built UI) on 127.0.0.1:1234
pnpm dev:ui                      # Next dev on 127.0.0.1:3000 (UI_PORT to change), /api proxied to the core server on 1234
pnpm adapter:cc ~/.postrun/captures > steps.json   # Claude Code captures -> Step[] JSON (no store)
pnpm adapter:cline <session-id> > steps.json       # Cline session -> Step[] JSON (no store)
pnpm typecheck                   # both packages
pnpm test                        # both packages
pnpm build                       # both packages
```

Adapters outside core can also push v1.2 batches to `POST /api/ingest` with the bearer token in `~/.postrun/ingest-token` (created on first serve); see `core/src/server/README.md`. The UI updates live as sessions are written, through `GET /api/events`.

Sessions are stored in `~/.postrun/postrun.db` (SQLite, override with `POSTRUN_DB` or `--db`). The server reads the store; it never runs adapters. Port precedence: `--port` flag, then `PORT` env, then 1234. It binds to 127.0.0.1 only.

```bash
pnpm serve --port 4321
pnpm serve --db /some/other/postrun.db
```

## Environment

**IMPORTANT**: No secrets or credentials ever go in this repository. All `.env` files are in `.gitignore` and must be created locally with secret values only. Never commit API keys, passwords, or authentication tokens of any kind.

## Security model

Postrun records full prompts, assistant responses, tool input, and tool output from this machine. Everything is local and single-user:

- Both listeners (the API server on 1234 and the OTLP receiver on 4318) bind to 127.0.0.1 only and refuse any request whose `Host` header is not `127.0.0.1`, `localhost`, or `[::1]`. That closes DNS rebinding, where a web page points its own domain at 127.0.0.1 to read the API from a browser. No CORS headers are ever sent.
- Everything Postrun writes under `~/.postrun` (captures, the SQLite store and its WAL, the ingest token) is created owner-only: directories 0700, files 0600. Older, wider files are tightened on open.
- The receiver caps export requests at 32 MB before and after gzip. The server never echoes internal error text.
- The API server has one write route, `POST /api/ingest`. It requires the bearer token in `~/.postrun/ingest-token` (0600), which a cross-site browser request cannot send, and caps bodies at 8 MB before and after gzip. Every batch is validated against v1.2 before anything is written.
- Postrun reads agent files (`~/.cline`, Claude Code hooks) but never writes them. The only file it edits outside `~/.postrun` is `~/.claude/settings.json`, backed up once and merged in place.
- Nothing leaves this machine unless you export it. `pnpm export` and the session page's Export button write one HTML report with secrets, credential values, and home paths masked, and list every masked value for you to check. The file has no scripts and makes no network requests. Redaction is automatic, not a guarantee: skim before sending. See `docs/decision-2026-10-positioning.md`.
- Postrun does not ask Claude Code to dump raw API bodies to disk. Capture files can still contain whatever a session printed, including the output of commands such as `env`; treat `~/.postrun` as sensitive.

## Architecture

See `core/README.md`, `ui/README.md`, and the README in each `core/src/*` subdirectory.
