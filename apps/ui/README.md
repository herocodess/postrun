# @postrun/ui

Next.js (App Router, TypeScript) session history and report views. Reads the core server's API; imports only types from `@postrun/core`.

- `/` history list: one row per stored session (agent badge, workspace, first prompt, started, step counts, cost, flags). Filter by agent with `?agent=<kind>`. Click a row to open the session.
- `/session?id=<id>` report: files touched and commands run at the top, then the timeline grouped by turn. Failed and reference-only steps are marked. Query-param routing keeps the page static-exportable.

```bash
pnpm --filter @postrun/ui dev     # Next dev on http://127.0.0.1:3000 (UI_PORT to change), proxies /api/* to the core server on 127.0.0.1:1234 (POSTRUN_CORE_URL to change)
pnpm --filter @postrun/ui build   # static export to ui/out, which the core server serves
pnpm --filter @postrun/ui test    # vitest for lib/
```

`next dev` and `next build` behave differently on purpose: rewrites (the /api proxy) only exist in dev, and `output: "export"` only applies to build. See `next.config.ts`.
