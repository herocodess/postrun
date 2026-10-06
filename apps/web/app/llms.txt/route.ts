/**
 * llms.txt: a plain summary of Postrun and links to its key pages, for AI
 * assistants and AI search (https://llmstxt.org). Keep it true and current.
 */
import { GUIDES } from "@/content/guides";
import { USE_CASES } from "@/content/use-cases";
import { DOCS_URL, SITE } from "@/content/seo";

export const dynamic = "force-static";

export function GET() {
  const text = `# Postrun

> Postrun is the flight recorder for coding agents. It records every command, edit, file read and reply that coding agents like Claude Code and Cline make, on the developer's own machine, and turns each session into a timeline to review. A session can be shared as a redacted HTML report or as a link that expires. Free and open source (MIT).

Key facts:

- Install: \`npm install -g postrun\`, then \`postrun setup\`. Needs Node.js 22.13 or later on macOS or Linux. Windows is not supported yet.
- Agents recorded today: Claude Code (through its hooks and OpenTelemetry export) and Cline (by reading its session store). Cursor and Codex are planned.
- Local first: the recorder and the review app listen on 127.0.0.1 only. Sessions are stored in ~/.postrun. No telemetry. Nothing leaves the machine unless the user exports or shares a session.
- Review: timeline of turns and steps, plain summary, per-file diffs, failed steps, risk flags (rm -rf, git reset --hard, force pushes, scripts piped to a shell, dropped tables, secrets in output, secrets files, edits outside the project), review verdicts, pull request summary, full-text search.
- Sharing: every export and share link is redacted (keys, tokens, passwords, private keys, emails, home paths) and the user sees every masked value first. Share links live at app.postrun.app, last 1 to 90 days, show open counts and can be turned off. They need a free account; recording does not.
- Not a cost dashboard: it shows reported cost and tokens, but the session and its review are the point.

## Product

- [Home](${SITE}/): what Postrun does and how it fits together
- [Live demo](${SITE}/demo/): the review app with example sessions
- [Example report](${SITE}/example-report.html): a real redacted export
- [Claude Code](${SITE}/claude-code/): recording and reviewing Claude Code sessions
- [Cline](${SITE}/cline/): recording and reviewing Cline tasks
- [Security](${SITE}/security/): what is recorded, where it lives, what never leaves
- [Changelog](${SITE}/changelog/)

## Guides

${GUIDES.map((g) => `- [${g.title}](${SITE}/guides/${g.slug}/): ${g.summary}`).join("\n")}

## Use cases

${USE_CASES.map((u) => `- [${u.title}](${SITE}/use-cases/${u.slug}/)`).join("\n")}

## Docs

- [Documentation](${DOCS_URL}/): quickstart, capture per agent, review, export and redaction, share links, CLI reference, ingest API, event schema, security model, troubleshooting
- [Docs for AI tools](${DOCS_URL}/llms.txt)

## Optional

- [Source code](https://github.com/herocodess/postrun)
- [npm package](https://www.npmjs.com/package/postrun)
`;
  return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
