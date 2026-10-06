# app.postrun.app

Accounts and share links for Postrun. Sign in with GitHub or an email link,
see your share links with open counts, turn them off, and connect computers
with `postrun login`. Recording never needs any of this.

Next.js on Vercel (region `lhr1`), Postgres on Neon (London), email through
Resend, auth with Better Auth.

## Run it on your machine

1. Copy `.env.example` to `.env.local` and fill it in. Use the **Postrun (local)**
   GitHub app and `BETTER_AUTH_URL=http://localhost:3001`.
2. Create the tables (safe to run again; it only adds what's missing):

   ```bash
   pnpm --filter @postrun/app db:migrate
   ```

3. Start it:

   ```bash
   pnpm --filter @postrun/app dev     # http://localhost:3001
   ```

   Without `RESEND_API_KEY`, sign-in links are printed in this terminal instead
   of emailed.

4. To share from your own Postrun against this local copy:

   ```bash
   POSTRUN_SHARE_SERVER=http://localhost:3001 postrun login
   ```

## Deploy on Vercel

New project from the repo, **Root Directory** `apps/app`. Add the variables
from `.env.example` under Settings → Environment Variables, with
`BETTER_AUTH_URL=https://app.postrun.app`, the **Postrun** GitHub app, and a
different `BETTER_AUTH_SECRET` from your local one. Add the domain
`app.postrun.app` under Settings → Domains. Run `db:migrate` again whenever
`db/schema.sql` or the auth setup changes.

## Tests

```bash
pnpm --filter @postrun/app test
# with a throwaway Postgres as well:
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postrun_test pnpm --filter @postrun/app test
```

## How sharing works

- `postrun share` (or **Share link** in the review app) uploads the redacted
  report, gzipped, to `POST /api/shares` with the computer's token.
- `/s/<id>` shows it in a sandboxed frame from `/s/<id>/report`, which is
  served with `Content-Security-Policy: sandbox` and no network access.
- `postrun login` opens `/cli`, which hands a one-time code back to the
  computer on `127.0.0.1`; the computer swaps it for a token at
  `/api/cli/token` with PKCE. Tokens are stored as SHA-256 hashes.
- Turning a link off deletes the report; expired reports are deleted on the
  next upload, list or view.
