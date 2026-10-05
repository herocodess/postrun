# @postrun/web

The postrun.app marketing site. Next.js, exported as static files: no server.

```bash
pnpm dev:web        # from the repo root: http://127.0.0.1:3100
pnpm build:web      # writes apps/web/out, deploy that folder to any static host
```

## What's where

- `app/page.tsx`: every section of the page, in order. Copy lives here.
- `components/LiveSession.tsx`: the hero's session window. Steps stream in, counters tick, and the AWS keys in step 4 scramble into `[REDACTED]`. Data is the example session also exported to `public/example-report.html`.
- `components/Terminal.tsx`: typing terminals. Pass a script of `cmd`, `out` and `comment` lines.
- `components/ExportDemo.tsx`: the export panel in the Sharing section.
- `components/Logo.tsx`: the "Step playback" mark. `app/icon.svg` and `app/apple-icon.png` are the favicons; `public/logo-mark*.svg` are standalone marks.
- `components/motion.ts`: `useInView`, `useReducedMotion`, and an abortable `sleep` for animation scripts.

Every animation starts when it scrolls into view and loops or holds. With the system's reduce-motion setting on, each one renders its final state instead, and CSS turns off all transitions.

## Before launch

- `NEXT_PUBLIC_WAITLIST_URL`: an endpoint that accepts a JSON POST with `email` (Formspree, Tally, a Worker). Until it's set, the form says it isn't connected rather than pretending.
- Placeholders still in the copy: the install command (the Record terminal says "install ships with early access") and `[GITHUB OR CONTACT]` in the footer.
- The terminals show a `postrun` CLI (`postrun capture`, `postrun export`). Today those are `pnpm capture` and `pnpm export` in the repo.
