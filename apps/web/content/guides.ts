/**
 * Guides: evergreen how-to pages written around the questions people actually
 * search for. Each slug has a page under app/guides/<slug>/. Every claim must
 * match what Postrun and the agents do today.
 */

export interface Guide {
  slug: string;
  title: string;
  /** Short label for lists and breadcrumbs. */
  short: string;
  summary: string;
  published: string;
  modified?: string;
}

export const GUIDES: Guide[] = [
  {
    slug: "see-what-claude-code-did",
    title: "How to see exactly what Claude Code did in a session",
    short: "See what Claude Code did",
    summary: "Every command it ran, every file it read or changed, what failed and what it cost: how to get a full, reviewable record of a Claude Code session instead of scrolling the terminal.",
    published: "2026-10-06",
  },
  {
    slug: "share-ai-coding-session-safely",
    title: "How to share an AI coding session without leaking secrets",
    short: "Share a session safely",
    summary: "Agent sessions are full of keys, tokens and private paths. How to send one to a reviewer, teammate or client with the secrets masked, and check the masking before it leaves.",
    published: "2026-10-06",
  },
  {
    slug: "review-ai-agent-session-checklist",
    title: "What to check before you trust an AI agent's work",
    short: "Agent review checklist",
    summary: "A practical checklist for reviewing a coding agent's session: destructive commands, force pushes, scripts piped to a shell, secrets in output, edits outside the project, and failures that were quietly worked around.",
    published: "2026-10-06",
  },
];

export function guideBySlug(slug: string): Guide {
  const g = GUIDES.find((x) => x.slug === slug);
  if (!g) throw new Error(`No guide with slug "${slug}" in content/guides.ts`);
  return g;
}
