# Contributing

Thanks for looking. Postrun is a small project, so issues are the best start:
describe the problem or idea before opening a large pull request.

## Working on it

```bash
pnpm install
pnpm test            # core tests
pnpm typecheck
pnpm dev:core        # the recorder's server on 127.0.0.1:1234
pnpm dev:ui          # the review app, with /api proxied to dev:core
```

The repo layout is in the README. `apps/app` (app.postrun.app) needs a
Postgres database and the settings in `apps/app/.env.example`.

## Ground rules

- Nothing leaves the user's computer unless they ask for it (an export or a
  share link). Changes that add network calls need a very good reason.
- Every captured string that can reach a shared report goes through redaction.
- Keep writing plain: short sentences, no jargon.

By contributing you agree that your work is released under the MIT license.
