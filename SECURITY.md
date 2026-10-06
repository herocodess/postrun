# Security

Postrun records what coding agents do on your computer, so security reports
get priority.

## Reporting a vulnerability

Email **hm@heromomoh.com** with what you found and how to reproduce it.
Please don't open a public issue for a vulnerability. You'll get a reply
within a few days, and credit in the changelog if you'd like it.

In scope:

- the `postrun` command and its background process (the capture receivers,
  the local server on 127.0.0.1 and the review app);
- redaction and export, including secrets that a report fails to mask;
- app.postrun.app (accounts and share links), postrun.app and
  docs.postrun.app.

Out of scope: reports that need someone else's unlocked computer, and
automated scanner output without a working example.

## How Postrun is built to be safe

See the security model at https://docs.postrun.app/security/.
