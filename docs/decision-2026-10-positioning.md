# Decision: record locally, share on purpose

Date: 2026-10-05. Status: accepted, to be validated (see "How we will know").

## The decision

Postrun records and reviews coding-agent sessions on the developer's own
machine. Nothing leaves that machine unless the developer chooses to share a
specific session. Sharing is a deliberate act on one session at a time, never a
background sync.

Postrun gets an internet presence through sharing, not through hosting
everyone's sessions.

## Why

- **What people asked for.** Interviews said the strongest need is session
  history plus a complete, legible report of what the agent did and touched. A
  report is something people pass on: to a reviewer before merging, to a
  teammate who inherits the branch, to a client who paid for the work, to a lead
  asking "what did the agent actually change?"
- **Where the idea started.** Postrun began as a review tool for teams running
  coding agents. Review is social. A single-player tool with no way to show
  anyone the result caps its own value.
- **Why not a cloud recorder.** Sessions hold full prompts, tool input, tool
  output, and anything an agent printed, including commands like `env`.
  Streaming all of that to a server by default makes Postrun a security
  liability first and a review tool second. Local capture is the trust story,
  and the reason a cautious team would install it.
- **Cost of being wrong.** Accounts, sync, and multi-user security are the most
  expensive things on the roadmap and the least certain to be wanted. Sharing
  lets us test the online side without building them.

## What this means for the product

1. **Capture and review stay local.** The capture receiver, store, and API keep
   binding to 127.0.0.1. No telemetry, no phone-home.
2. **Share = export first.** A session exports to one self-contained HTML
   report: no server, no account, opens in any browser, can be attached,
   emailed, or hosted anywhere.
3. **Redaction is part of sharing, not an option.** Every export passes through
   redaction: known secret formats, credential-shaped `KEY=value` pairs, and
   private paths are masked. The exporter reports what it masked and the
   developer reviews it before sending. Nothing is shareable without this step.
4. **Hosted links come later, built on the same file.** If people share
   exports, the next step is `postrun share`, which uploads the same redacted
   report to `app.postrun.app/s/<id>`: unlisted, expiring, revocable. Team
   workspaces, if ever, come after that.
5. **The website sells the report.** `postrun.app` shows a real exported
   report as its demo. Visitors see exactly what Postrun produces.

## What we are not building yet

- Accounts or login on `app.postrun.app`.
- Background sync of sessions to any server.
- Team dashboards, cost analytics, org-wide views.

## How we will know

Give the export to 3 to 5 interview participants and watch for two weeks.

- **Go for hosted links** if at least two of them send an export to someone
  else unprompted, or ask for a link instead of a file.
- **Stay export-only** if they open their own reports but do not share them.
  Postrun remains a strong local tool with a clear privacy story.
- **Revisit redaction** if anyone hesitates to share because they do not trust
  what it masked. That is the real blocker, and it is cheaper to fix than to
  build hosting.

## Naming

- `postrun.app`: marketing site, docs, download, example report.
- `app.postrun.app`: reserved for hosted share links and, later, accounts. Not
  `dev.`, which reads as a staging environment.
