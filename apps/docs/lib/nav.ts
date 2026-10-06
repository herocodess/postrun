/**
 * The docs sidebar, in reading order. Every page here must exist as
 * app/<href>/page.mdx (the root is app/page.mdx). Search, the sidebar and the
 * previous/next links all read from this list.
 */

export interface DocPage {
  href: string;
  title: string;
  /** One line, shown in search results. */
  description: string;
  /** Extra words search should match. */
  keywords?: string;
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

export const NAV: DocSection[] = [
  {
    title: "Getting started",
    pages: [
      { href: "/", title: "Introduction", description: "What Postrun is and how the pieces fit together.", keywords: "overview what is" },
      { href: "/quickstart/", title: "Quickstart", description: "Record your first agent session and review it.", keywords: "install setup start" },
    ],
  },
  {
    title: "Capture",
    pages: [
      { href: "/capture/claude-code/", title: "Claude Code", description: "Record Claude Code sessions with telemetry and hooks.", keywords: "otlp hooks settings.json" },
      { href: "/capture/cline/", title: "Cline", description: "Record Cline sessions from its local task store.", keywords: "vscode extension" },
      { href: "/capture/other-agents/", title: "Other agents", description: "Push sessions from any agent through the ingest API.", keywords: "cursor codex adapter custom" },
    ],
  },
  {
    title: "Review and share",
    pages: [
      { href: "/review/", title: "Reviewing sessions", description: "The session list, the session view, and live updates.", keywords: "timeline ui live" },
      { href: "/export/", title: "Exporting and redaction", description: "Share one session as a redacted HTML report.", keywords: "share report redact secrets" },
      { href: "/share/", title: "Share links", description: "Send a redacted report as an unlisted link that expires.", keywords: "share link login account upload app.postrun.app" },
    ],
  },
  {
    title: "Reference",
    pages: [
      { href: "/reference/cli/", title: "CLI", description: "Every command and flag.", keywords: "pnpm commands flags" },
      { href: "/reference/ingest-api/", title: "Ingest API", description: "POST /api/ingest: push v1.2 batches.", keywords: "http token bearer batch" },
      { href: "/reference/events-api/", title: "Live events API", description: "GET /api/events: server-sent change stream.", keywords: "sse stream live" },
      { href: "/reference/schema/", title: "Event schema v1.2", description: "Sessions, turns, steps and payloads.", keywords: "types step turn session payload" },
    ],
  },
  {
    title: "Security",
    pages: [
      { href: "/security/", title: "Security model", description: "What Postrun records, where it lives, and what never leaves your machine.", keywords: "privacy localhost redaction threat" },
      { href: "/troubleshooting/", title: "Troubleshooting", description: "Fixes for the common problems.", keywords: "errors port in use help" },
    ],
  },
];

export const ALL_PAGES: DocPage[] = NAV.flatMap((s) => s.pages);

export const SITE = "https://postrun.app";
export const DOCS = "https://docs.postrun.app";
