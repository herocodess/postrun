# @postrun/core

The logic package. Node 20+, ESM, strict TypeScript.

```
src/
  schema/               v1.2 types and runtime validator (Session, Segment, Actor, Turn, Step, payloads, Flag, Verdict)
  adapters/claude-code/ otlp-logs.ndjson + hooks.ndjson -> Step[] (read only)
  adapters/cline/       ~/.cline/data/sessions/<id> -> Step[], Turn[] with plan/act mode, one root actor (read only)
  store/                SQLite store (better-sqlite3): ingest adapter output idempotently, list and load sessions
  report/               read projections: files touched, commands run
  server/               localhost-only HTTP server over the store: GET /api/sessions, GET /api/sessions/:id, GET / (apps/ui/out)
  capture/              later
  ai/                   later
  index.ts              public surface
```

Subpath exports for the UI and other consumers: `@postrun/core`, `@postrun/core/schema`, `@postrun/core/server`, `@postrun/core/adapters/claude-code`. The `types` condition points at `src/` so type-only imports need no build; runtime imports resolve to `dist/` after `pnpm build`.

```bash
pnpm typecheck
pnpm test                                  # includes tests against the real files in ~/.postrun/captures (skipped if absent)
pnpm adapter:cc ~/.postrun/captures        # Step[] JSON on stdout, summary on stderr
pnpm adapter:cline <session-id | dir | messages.json>
pnpm ingest --agent claude-code|cline <source> [--db path]
pnpm sessions [--agent kind] [--db path]
pnpm serve [--port n] [--db path] [--ui dir]
pnpm build && pnpm start                   # compiled server from dist/
```
