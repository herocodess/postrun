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
- `content/faq.ts`: FAQ copy, shown on the home page and published as FAQPage structured data.
- `app/privacy`, `app/terms`: draft legal pages (shared layout in `components/LegalPage.tsx`). Cookies are covered in the privacy policy at `/privacy#cookies`.
- `components/motion.ts`: `useInView`, `useReducedMotion`, and an abortable `sleep` for animation scripts.

Every animation starts when it scrolls into view and loops or holds. With the system's reduce-motion setting on, each one renders its final state instead, and CSS turns off all transitions.

## Before launch

`pnpm build` ends with `scripts/prod-check.mjs`, which scans the built site for unfilled `[PLACEHOLDERS]`, an unset or CSP-blocked waitlist endpoint, and an expired `security.txt`. Locally and on preview deployments it only warns. On a Vercel production deployment (`VERCEL_ENV=production`) it fails the build, so an unfinished page can't go live. Run `pnpm --filter @postrun/web check:prod` after a build to see the list.

Security headers (CSP, HSTS, nosniff, frame and referrer rules) live in `vercel.json`. The CSP allows network requests to this origin only, so when you choose a waitlist provider add its origin to `connect-src` (the check above tells you the exact origin).

- `NEXT_PUBLIC_WAITLIST_URL`: the Formspree form endpoint, `https://formspree.io/f/<form id>`, set in the Vercel project's environment variables. Formspree emails you each sign-up. Until it's set, the form tells visitors sign-ups aren't open yet.
- Contact details (email, GitHub link) live in `content/site.ts`. The GitHub link points at the profile while the repo is private.
- No cookie banner, on purpose: the site sets no cookies and no browser storage. Analytics is Vercel Web Analytics, which is cookieless, and it is described in `/privacy#website`.
- Analytics: turn on Web Analytics for the project in the Vercel dashboard. It loads only on Vercel builds (`VERCEL=1`), so local builds have no tracking script. Clicks on anything with `data-track="Name"` (plus optional `data-track-where`) are sent as custom events by `components/ClickTracker.tsx`, and a successful waitlist sign-up sends `Waitlist signup`. Custom events need Vercel's Pro plan; on Hobby only page views are recorded.
- Renew the `Expires` date in `public/.well-known/security.txt` before it passes (the build check fails once it has).
- Draft blog posts appear in dev and previews only; production lists published posts.
- Placeholders still in the copy: the install command (the Record terminal says "install ships with early access").
- The terminals show a `postrun` CLI (`postrun capture`, `postrun export`). Today those are `pnpm capture` and `pnpm export` in the repo.
