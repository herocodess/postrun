/**
 * Changelog, newest first. Built from the repository's git history and
 * grouped by day; each entry says what a user can now do, not the commit
 * message. Releases are labelled by date: there are no version numbers yet.
 *
 * Only add things that actually shipped. Internal moves with no visible
 * change (for example relocating a package) are left out.
 */

export type ChangeKind = "new" | "improved" | "fixed" | "security";

export interface Release {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  title: string;
  summary?: string;
  items: Array<{ kind: ChangeKind; text: string }>;
}

export const RELEASES: Release[] = [
  {
    date: "2026-10-06",
    title: "postrun.app goes up",
    summary: "The website you are reading, with a live demo of a recorded session and a real exported report.",
    items: [
      { kind: "new", text: "postrun.app, with an animated example session, the three steps of record, review and share, and an early access waitlist." },
      { kind: "new", text: "An example exported report you can open in your browser, the same file Postrun writes on export." },
      { kind: "new", text: "FAQ and a plain-language privacy page. The site sets no cookies." },
      { kind: "new", text: "Cookieless visit and click counts with Vercel Web Analytics, described on the privacy page." },
      { kind: "improved", text: "A translucent header that folds into a pill as you scroll, and layouts for foldable and dual-screen devices." },
    ],
  },
  {
    date: "2026-10-05",
    title: "Share a session, watch it live",
    summary: "The first piece of sharing on purpose, plus a review app that updates while the agent works.",
    items: [
      {
        kind: "new",
        text: "Export a session as one self-contained HTML report, from the command line or the Export button on the session page. It has no JavaScript, makes no outside requests, and opens in any browser.",
      },
      {
        kind: "new",
        text: "Redaction on every export: private keys, AWS, GitHub, Anthropic, OpenAI, Stripe, Slack and Google keys, JWTs, passwords in URLs, Authorization headers and credential-named values are masked, and home folder paths become ~. Every masked value is listed for you to check before sending.",
      },
      { kind: "new", text: "The export panel in the review app shows what will be masked before the file downloads." },
      { kind: "new", text: "Live session view: open sessions update as steps are recorded, and catch up on their own after the server restarts or the tab reconnects." },
      { kind: "new", text: "The status pill in the review app shows the real connection state: live, connecting or server offline." },
      {
        kind: "new",
        text: "An ingest API for your own adapters: push sessions to POST /api/ingest with a local bearer token. Every batch is validated against the v1.2 schema before anything is stored.",
      },
      {
        kind: "improved",
        text: "Starting capture now configures Claude Code for you if needed. Your settings file is backed up once, merged in place, and running it again changes nothing.",
      },
      { kind: "improved", text: "A refreshed review app: session list, session report and top bar." },
      {
        kind: "security",
        text: "The recorder and the API refuse requests whose Host header is not a loopback name, which blocks DNS rebinding. No CORS headers are sent.",
      },
      { kind: "security", text: "Everything Postrun writes under ~/.postrun is owner-only: folders 0700, files 0600. Older, wider files are tightened when opened." },
      { kind: "security", text: "Size limits on incoming data, and internal error details are never sent back in responses." },
      { kind: "fixed", text: "The last batch of telemetry is no longer lost when capture stops." },
    ],
  },
  {
    date: "2026-09-08",
    title: "Live capture for Claude Code and Cline",
    summary: "Postrun starts recording sessions as they happen, on your own machine.",
    items: [
      { kind: "new", text: "A local telemetry receiver on 127.0.0.1 and a hook script record Claude Code sessions while they run." },
      { kind: "new", text: "Cline sessions are picked up from Cline's own session folder." },
      { kind: "new", text: "One capture command runs the receiver and both watchers, or ingests whatever is already on disk and exits." },
      { kind: "improved", text: "Capture files that hold several Claude Code sessions are split into separate sessions, with the working folder and agent version shown." },
    ],
  },
];
