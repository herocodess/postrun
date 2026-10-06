# Store

Local SQLite store (better-sqlite3) for normalized sessions. Default file `~/.postrun/postrun.db`, override with `--db` or `POSTRUN_DB`.

Tables follow v1.2: `sessions`, `segments`, `actors`, `turns`, `steps`. Steps hold `payload`, `channels`, and `flags` as JSON text, unchanged. Ingest takes a whole session from a capture: it upserts by `(session_id, id)` and removes steps, turns, actors and segments the record no longer contains, so re-ingesting is idempotent and never leaves duplicates. Pushed batches (`appendBatch`, the ingest API) are incremental and never delete.

Projected on read, never stored: step counts by type, failed and reference-only counts, flag count, turn count, the session title (first user prompt), and each turn's `step_ids`. The one stored total is the adapter-reported API metrics (cost, requests, tokens), because API request events are session-level telemetry and not steps, so cost cannot be rebuilt from the step stream.

Ownership seam: every session row has `owner_id` (always `local` for now) and `captured_on` (this hostname). No users, auth, or sharing exist; the columns are there so team sync is a data-source change later, not a migration.

```bash
pnpm ingest --agent claude-code ~/.postrun/captures
pnpm ingest --agent cline 1788568010939_qp82o
pnpm sessions                     # newest first
pnpm sessions --agent cline
```

Programmatic: `new PostrunStore({ path })`, then `ingest(record)`, `listSessions({ agent })`, `getSession(id)`, `counts()`. Build records with `claudeCodeRecord(dir)` or `clineRecord(idOrPath)`.
