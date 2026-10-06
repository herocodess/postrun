# Capture

Live capture: records new sessions as they happen and ingests them into the store. Everything binds to 127.0.0.1. Read only on every agent source file; Postrun writes only inside its own capture directory.

It is built to stay light on a heavy day (several agents in parallel for hours, on top of weeks of history): no file is ever read whole, a turn's work depends on that session only, and each busy session is paced to about 1% of a CPU core. `pnpm --filter @postrun/core bench:heavy` measures it.

```bash
pnpm capture            # self-configures Claude Code if needed, then OTLP receiver on 127.0.0.1:4318 + both watchers; keeps running
pnpm capture --once     # ingest whatever is on disk now, then exit (no configuration step)
pnpm capture:cc:setup   # only the configuration step: merge Postrun's env + hooks into ~/.claude/settings.json
```

## Claude Code configuration

`setup.ts` edits `~/.claude/settings.json` (override with `POSTRUN_CLAUDE_SETTINGS`) so that Claude Code exports OTel to the receiver and runs the hook script. Rules:

- The original file is copied to `~/.claude/settings.json.postrun-backup` before the first change, and never again, so the backup stays the true original. Nothing is ever deleted.
- The merge adds Postrun's env vars and one Postrun hook for each of `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SessionEnd`. Every other top-level key, env var, hook group, and matcher is carried over unchanged. Postrun's hooks are recognised by their command path (the repo's `capture-hook.sh`, or an earlier Postrun `capture.sh` under a `postrun` directory, since both append to the same `hooks.ndjson`) and updated in place, so running it again changes nothing and never duplicates an entry. A Postrun env key that already holds a different value is replaced and the old value is printed.
- The write is atomic (temp file plus rename), keeps the file's mode, and the hook script is made executable. If the file is not valid JSON nothing is written and the error names the file. The hook command path is single-quoted when it contains characters the shell would interpret. Retired keys are removed when they carry Postrun's own values: `OTEL_LOG_RAW_API_BODIES` pointing inside `~/.postrun` (it made Claude Code write every raw API request to disk), and the metrics and traces exporters and their intervals when the endpoint is Postrun's receiver (Postrun only reads logs). A user's own OpenTelemetry settings are left alone.
- `pnpm capture` runs the same check on start: already configured means a one-line "already present" and no write; otherwise it configures and prints what it did. `--once` skips this.
- Claude Code reads `settings.json` only at launch. A session that was already running when the config was written keeps its old settings until it is restarted. Its hooks are still recorded (see below), so it is captured without cost and token counts.

## Claude Code

Layout (`layout.ts`):

```
~/.postrun/captures/hooks.ndjson                      inbox: the hook script appends every event here
~/.postrun/captures/sessions/<id>/hooks.ndjson        one session's hook events, routed from the inbox
~/.postrun/captures/sessions/<id>/otlp-logs.ndjson    one session's telemetry, split by the receiver
```

- `scripts/capture-hook.sh` appends one NDJSON line per hook event to the inbox. It stays a plain append so it never slows Claude Code down.
- `receiver.ts` accepts OTLP http/json on 127.0.0.1:4318. Log exports are split by `session.id` and appended to each session's folder. Metrics and traces are accepted and dropped (setup no longer asks for them).
- `claude-code-watcher.ts` routes the inbox: every second it reads only the bytes added since last time, in 4 MB chunks, and appends each line to its session's folder. The read position is saved in `.router-state.json` (with the inbox's inode), so a restart resumes exactly and never routes a line twice. Once fully routed and over 1 MB, the inbox is renamed and drained, so it never grows.
- On each `Stop` (end of an assistant turn) and `SessionEnd` the watcher ingests that session from its folder only, at least 4 s after the event so the last OTel exports arrive. Ingests are paced by `pacer.ts`: triggers merge, and the next ingest of a session waits at least its last ingest's cost divided by 1%, so a very long session is refreshed less often instead of costing more (at most 60 s apart while busy). A session appears in the history while still open, with `ended_at` unset.
- The store writes only steps whose content changed (a hash per step), so a turn writes that turn's steps, not the whole session.
- On start the watcher catches up: every session folder not already complete in the store (new, or stored without an end) is ingested. Sessions that ran while capture was stopped are recovered this way.
- Clean-up: a session folder idle for 24 hours is ingested one final time and deleted; the store keeps everything the review app and exports use. Set `POSTRUN_KEEP_CAPTURES=1` to keep the folders.
- The first start after upgrading splits an old shared `otlp-logs.ndjson` into the session folders (streamed) and removes it, along with `otlp-metrics.ndjson` and `otlp-traces.ndjson`, which were never read.
- Claude Code writes `hooks.ndjson` itself, through the hook script, whether or not capture is running. So a session with no OTel data (the receiver was down, or claude started before setup) is built from its hooks alone: every prompt, tool call with full input and output, and final reply, ordered by time. Only cost, tokens and permission decisions are missing; the watcher logs this once per session ("recorded from hooks only"). When OTel covers only part of a session, the turns it missed are filled from hooks the same way.

## Cline

- `cline-watcher.ts` watches `~/.cline/data/sessions` (fs.watch plus a 3s mtime poll). On startup it ingests every session whose files changed since it was last stored; unchanged history is not re-read. When a session's messages or metadata file changes, or a new session directory appears, it re-ingests that session at least 2 s later. Cline rewrites its whole messages file on every message, so re-reads are paced by `pacer.ts` like Claude Code's: about 1% of a core per busy session, and once more when it goes quiet. Every ingest is an upsert that writes only changed steps. A half-written file fails to parse and is retried on the next change.

## Env

`POSTRUN_CAPTURE_DIR` (default `~/.postrun/captures`), `POSTRUN_CLINE_DIR` (default `~/.cline/data/sessions`), `POSTRUN_OTLP_PORT` (default 4318), `POSTRUN_DB` (default `~/.postrun/postrun.db`), `POSTRUN_KEEP_CAPTURES=1` (keep raw session folders instead of deleting them 24 hours after they go idle).

The store is opened with a 5s busy timeout so `pnpm capture` (writer) and `pnpm serve` (reader) share the SQLite file; the server re-queries on every request, so new sessions show up without a restart.

## Hardening

The receiver refuses non-loopback `Host` headers (421), caps each export at 32 MB before and after gzip (413 or 400), and only accepts the three signal paths as own properties. The capture directory is created 0700 and every file it writes is 0600; the hook script sets `umask 077` for the same reason. Session ids read from `hooks.ndjson` and from Cline's session directory names must be plain tokens (letters, digits, `_ . -`) before they are used in paths or logs.
