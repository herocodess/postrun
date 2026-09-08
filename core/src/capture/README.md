# Capture

Live capture: records new sessions as they happen and ingests them into the store. Everything binds to 127.0.0.1. Read only on every agent source file; the only writes are the receiver appending its own `otlp-*.ndjson` files and the hook script appending `hooks.ndjson`.

```bash
pnpm capture:cc:setup   # print the env + hooks block to merge into ~/.claude/settings.json (never edits it)
pnpm capture            # OTLP receiver on 127.0.0.1:4318 + both watchers; keeps running
pnpm capture --once     # ingest whatever is on disk now, then exit
```

## Claude Code

- `scripts/capture-hook.sh` appends one NDJSON line per hook event to `~/.postrun/captures/hooks.ndjson`.
- `receiver.ts` accepts OTLP http/json on 127.0.0.1:4318 and appends `otlp-logs/metrics/traces.ndjson`.
- `claude-code-watcher.ts` tails `hooks.ndjson`. On each `Stop` (end of an assistant turn) and on `SessionEnd` it runs the Claude Code adapter for that session and upserts it into the store, after a 4s debounce so the last OTel exports arrive. A session therefore appears in the history while still open, with `ended_at` unset, and is updated on every turn. Sessions whose claude was launched without the OTel env have hooks but no otlp-logs; they are reported once and skipped, because the adapter needs otlp-logs for ordering and cost.

## Cline

- `cline-watcher.ts` watches `~/.cline/data/sessions` (fs.watch plus a 3s mtime poll). On startup it ingests every session present. When a session's messages or metadata file changes, or a new session directory appears, it re-ingests that session after a 2s debounce. Cline rewrites the messages file during a session, so open sessions are ingested repeatedly; every ingest is an upsert. A half-written file fails to parse and is retried on the next change.

## Env

`POSTRUN_CAPTURE_DIR` (default `~/.postrun/captures`), `POSTRUN_CLINE_DIR` (default `~/.cline/data/sessions`), `POSTRUN_OTLP_PORT` (default 4318), `POSTRUN_DB` (default `~/.postrun/postrun.db`).

The store is opened with a 5s busy timeout so `pnpm capture` (writer) and `pnpm serve` (reader) share the SQLite file; the server re-queries on every request, so new sessions show up without a restart.
