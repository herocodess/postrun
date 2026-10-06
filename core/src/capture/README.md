# Capture

Live capture: records new sessions as they happen and ingests them into the store. Everything binds to 127.0.0.1. Read only on every agent source file; the only writes are the receiver appending its own `otlp-*.ndjson` files and the hook script appending `hooks.ndjson`.

```bash
pnpm capture            # self-configures Claude Code if needed, then OTLP receiver on 127.0.0.1:4318 + both watchers; keeps running
pnpm capture --once     # ingest whatever is on disk now, then exit (no configuration step)
pnpm capture:cc:setup   # only the configuration step: merge Postrun's env + hooks into ~/.claude/settings.json
```

## Claude Code configuration

`setup.ts` edits `~/.claude/settings.json` (override with `POSTRUN_CLAUDE_SETTINGS`) so that Claude Code exports OTel to the receiver and runs the hook script. Rules:

- The original file is copied to `~/.claude/settings.json.postrun-backup` before the first change, and never again, so the backup stays the true original. Nothing is ever deleted.
- The merge adds Postrun's env vars and one Postrun hook for each of `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SessionEnd`. Every other top-level key, env var, hook group, and matcher is carried over unchanged. Postrun's hooks are recognised by their command path (the repo's `capture-hook.sh`, or an earlier Postrun `capture.sh` under a `postrun` directory, since both append to the same `hooks.ndjson`) and updated in place, so running it again changes nothing and never duplicates an entry. A Postrun env key that already holds a different value is replaced and the old value is printed.
- The write is atomic (temp file plus rename), keeps the file's mode, and the hook script is made executable. If the file is not valid JSON nothing is written and the error names the file. The hook command path is single-quoted when it contains characters the shell would interpret. The retired `OTEL_LOG_RAW_API_BODIES` key is removed when its value points inside `~/.postrun`, because it made Claude Code write every raw API request to disk and Postrun never read them.
- `pnpm capture` runs the same check on start: already configured means a one-line "already present" and no write; otherwise it configures and prints what it did. `--once` skips this.
- Claude Code reads `settings.json` only at launch. A session that was already running when the config was written keeps its old settings until it is restarted. Its hooks are still recorded (see below), so it is captured without cost and token counts.

## Claude Code

- `scripts/capture-hook.sh` appends one NDJSON line per hook event to `~/.postrun/captures/hooks.ndjson`.
- `receiver.ts` accepts OTLP http/json on 127.0.0.1:4318 and appends `otlp-logs/metrics/traces.ndjson`.
- `claude-code-watcher.ts` tails `hooks.ndjson`. On each `Stop` (end of an assistant turn) and on `SessionEnd` it runs the Claude Code adapter for that session and upserts it into the store, after a 4s debounce so the last OTel exports arrive. A session therefore appears in the history while still open, with `ended_at` unset, and is updated on every turn.
- On start the watcher catches up: every session in `hooks.ndjson` that is not already complete in the store (new, or stored without an end) is ingested, reading both files once. Sessions that ran while capture was stopped are recovered this way.
- Claude Code writes `hooks.ndjson` itself, through the hook script, whether or not capture is running. So a session with no OTel data (the receiver was down, or claude started before setup) is built from its hooks alone: every prompt, tool call with full input and output, and final reply, ordered by time. Only cost, tokens and permission decisions are missing; the watcher logs this once per session ("recorded from hooks only"). When OTel covers only part of a session, the turns it missed are filled from hooks the same way.

## Cline

- `cline-watcher.ts` watches `~/.cline/data/sessions` (fs.watch plus a 3s mtime poll). On startup it ingests every session present. When a session's messages or metadata file changes, or a new session directory appears, it re-ingests that session after a 2s debounce. Cline rewrites the messages file during a session, so open sessions are ingested repeatedly; every ingest is an upsert. A half-written file fails to parse and is retried on the next change.

## Env

`POSTRUN_CAPTURE_DIR` (default `~/.postrun/captures`), `POSTRUN_CLINE_DIR` (default `~/.cline/data/sessions`), `POSTRUN_OTLP_PORT` (default 4318), `POSTRUN_DB` (default `~/.postrun/postrun.db`).

The store is opened with a 5s busy timeout so `pnpm capture` (writer) and `pnpm serve` (reader) share the SQLite file; the server re-queries on every request, so new sessions show up without a restart.

## Hardening

The receiver refuses non-loopback `Host` headers (421), caps each export at 32 MB before and after gzip (413 or 400), and only accepts the three signal paths as own properties. The capture directory is created 0700 and every file it writes is 0600; the hook script sets `umask 077` for the same reason. Session ids read from `hooks.ndjson` and from Cline's session directory names must be plain tokens (letters, digits, `_ . -`) before they are used in paths or logs.
