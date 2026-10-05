# Server

Localhost-only HTTP server (Node built-in `http`) over the SQLite session store. Binds to `127.0.0.1` and nothing else; the host is not configurable. It never runs adapters: ingest first.

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
- `GET /` and other paths serve the static Next export from `ui/out`; extensionless paths map to `<name>.html`.

If the port is taken, it exits with a message naming the port and the `--port` / `PORT` overrides. No auth and no rate limiting, because it is never network-reachable.

Hardening: requests whose `Host` header is not a loopback name get 421 (DNS rebinding guard, see `src/util/host.ts`); responses carry `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, `cache-control: no-store`, and no CORS headers; malformed percent-encoding is a 400; internal errors are logged to stderr and returned as a generic 500; static paths are resolved and checked against the UI directory, and `..` in the path is refused outright.
