# Server

Localhost-only HTTP server (Node built-in `http`) over the SQLite session store. Binds to `127.0.0.1` and nothing else; the host is not configurable. It never runs adapters: sessions arrive through `pnpm ingest` (whole captures) or `POST /api/ingest` (pushed batches).

```bash
pnpm ingest --agent claude-code ~/.postrun/captures
pnpm ingest --agent cline <session-id>
pnpm serve                          # builds the UI, then listens on http://127.0.0.1:1234/
pnpm serve --port 4321              # flag wins over PORT env, which wins over the 1234 default
pnpm serve --db /some/postrun.db    # default ~/.postrun/postrun.db or POSTRUN_DB
```

Routes:

- `GET /api/sessions[?agent=<kind>]` returns `{ sessions, agents }`, newest first. Counts, title, and flag count are projected on read.
- `GET /api/sessions/:id` returns the full session (summary, segments, actors, turns, steps) plus `report` (files touched, commands run).
- `GET /api/events[?session=<id>]` is a live stream (server-sent events) of which sessions changed (below).
- `POST /api/ingest` accepts one v1.2 batch from an adapter (see below). The only write route.
- `GET /` and other paths serve the static Next export from `ui/out`; extensionless paths map to `<name>.html`.

If the port is taken, it exits with a message naming the port and the `--port` / `PORT` overrides. Read routes have no auth and nothing has rate limiting, because the server is never network-reachable. The ingest route needs a bearer token.

Hardening: requests whose `Host` header is not a loopback name get 421 (DNS rebinding guard, see `src/util/host.ts`); responses carry `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, `cache-control: no-store`, and no CORS headers; malformed percent-encoding is a 400; internal errors are logged to stderr and returned as a generic 500; static paths are resolved and checked against the UI directory, and `..` in the path is refused outright.

## Push ingest: `POST /api/ingest`

For adapters that run outside core (Cursor, Codex, anything new) and stream a session as it happens. Wire types are `IngestRequest`, `IngestResponse`, and `IngestErrorResponse` in `api.ts`; the checks live in `ingest.ts`, the store write in `PostrunStore.appendBatch`.

```bash
TOKEN=$(cat ~/.postrun/ingest-token)   # created on first `pnpm serve`; POSTRUN_INGEST_TOKEN_FILE overrides the path
curl -X POST http://127.0.0.1:1234/api/ingest \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d @batch.json
```

```jsonc
{
  "schema_version": "1.2",
  "session": { "id": "...", "agent": { "kind": "cursor", "version": "1.2.0" }, "workspace": { "root": "/repo" },
               "started_at": "2026-10-05T22:00:00Z" },   // optional: ended_at, source, metrics
  "segments": [], "actors": [], "turns": [], "steps": []  // each optional
}
```

- **Incremental.** Children are upserted by id (segments by index) and nothing is deleted, so a re-sent batch is a no-op. On an existing session, `ended_at`, `source`, and `metrics` change only when sent; a steps-only batch never zeroes cost. Pushes never touch the verdict.
- **Checked before writing**, all or nothing: envelope and session header, then every child through the v1.2 runtime validator (`schema/validate.ts`), then references. A child's turn, actor, and segment must already be stored or be in the same batch, and `session_id` must match. `Turn.step_ids` is accepted and ignored; it is projected from steps.
- **seq is unique per session.** Re-sending a step with its own seq is fine; a different step id on a taken seq is a 409.
- **Limits.** 8 MB per body, before and after gzip (`content-encoding: gzip` is accepted). 5000 items of each kind per batch; split bigger sessions. Error responses list up to 100 problems, each with a path such as `steps[3].payload.exit_code`.

Status codes: 201 session created, 200 updated, 400 invalid (with `details`), 401 bad or missing token, 405 not POST, 409 seq conflict, 413 too large, 415 not JSON or unknown encoding.

Why a token on a loopback server: the Host check stops DNS rebinding, but any web page can still fire a blind cross-site POST at 127.0.0.1. A browser cannot attach an `Authorization` header to that without a CORS preflight, which this server never approves. The token file is 0600, which also keeps other local users out. Delete it to rotate.

## Live stream: `GET /api/events`

Server-sent events saying which session was just written, so the UI can refetch instead of polling. `?session=<id>` limits the stream to one session.

```
retry: 2000

event: ready
data: {}

event: change
data: {"session_id":"3ac04cde-...","updated_at":"2026-10-05T22:14:03.512Z"}

: ping
```

- **Every writer is seen.** Capture watchers and `pnpm ingest` write from other processes, so the feed (`live.ts`) polls `sessions.updated_at` every 500 ms rather than relying on an in-process event. It polls only while a client is connected, and `POST /api/ingest` nudges it so pushes show up straight away.
- **Events name the session, not the change.** Clients refetch `GET /api/sessions/:id`. A writer may rewrite earlier steps (a Claude Code hook record arrives after its OTLP event and turns a reference-only step into an inline one), which a seq-based delta would miss. One poll tick sends at most one event per session, so bursts coalesce.
- **No replay.** `ready` arrives on every connect and reconnect, and clients should refetch on it. Changes made while disconnected are covered by that refetch.
- **Limits.** 32 simultaneous streams (503 beyond that), a comment line every 15 s to keep idle connections open, and all streams end when the server stops. Same Host check and no CORS headers as every other route, so other sites cannot read it.

The UI opens one stream per tab (`ui/lib/live.tsx`). The top bar pill shows `live`, `connecting`, or `server offline` from that connection, and the session list and session view refetch in place.
