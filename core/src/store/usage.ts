/**
 * Local usage counts: how often each Postrun feature is used, per day, kept in
 * the store on this machine and never sent anywhere. They exist so a person
 * can see their own use (Settings, `postrun stats`) and choose to share a
 * summary, for example with the Postrun team during an interview.
 *
 * Only the events below can be counted. Each count is a day and a number:
 * no session ids, no paths, no text, nothing about what an agent did.
 */

export const USAGE_EVENTS = {
  app_opened: "Opened the review app",
  session_viewed: "Looked at a session",
  review_marked: "Marked a review",
  pr_summary_copied: "Copied a PR summary",
  changes_viewed: "Opened the Changes tab",
  report_exported: "Exported a report",
  reports_zipped: "Exported several reports as a zip",
  search: "Searched sessions",
  keyboard_used: "Used keyboard shortcuts",
  backup_saved: "Saved a backup",
} as const;

export type UsageEvent = keyof typeof USAGE_EVENTS;

/** Events the review app reports itself (things only the page sees). The rest are counted by the server as they happen. */
export const CLIENT_USAGE_EVENTS: readonly UsageEvent[] = ["app_opened", "session_viewed", "pr_summary_copied", "changes_viewed", "keyboard_used"];

export function isUsageEvent(e: unknown): e is UsageEvent {
  return typeof e === "string" && Object.hasOwn(USAGE_EVENTS, e);
}

/** Daily rows older than this are dropped as new ones are written. */
export const USAGE_KEEP_DAYS = 400;

export interface UsageSummary {
  /** The first day anything was counted, YYYY-MM-DD. */
  since?: string;
  /** Days in the last 30 on which the review app was opened. */
  days_active_30: number;
  /** Per event: all time, and the last 30 days. Every event is present, zero when unused. */
  events: Record<UsageEvent, { total: number; last_30: number }>;
  /** The last 30 days, oldest first: whether the app was opened, and how many features were used. */
  daily: Array<{ day: string; opened: boolean; actions: number }>;
  sessions: { total: number; by_agent: Record<string, number>; first_at?: string; last_30: number };
  version: string;
  platform: string;
}

/** The plain-text summary `postrun stats` prints and Settings copies: counts only, ready to paste. */
export function formatUsage(u: UsageSummary): string {
  const lines: string[] = [];
  lines.push(`Postrun ${u.version} usage (${u.platform}). Counts only: no sessions, paths or text.`);
  lines.push(u.since ? `Counting since ${u.since}.` : "Nothing counted yet.");
  lines.push("");
  lines.push(`Sessions recorded: ${u.sessions.total} (${u.sessions.last_30} in the last 30 days)`);
  const agents = Object.entries(u.sessions.by_agent);
  if (agents.length) lines.push(`  by agent: ${agents.map(([k, n]) => `${k} ${n}`).join(", ")}`);
  if (u.sessions.first_at) lines.push(`  first: ${u.sessions.first_at.slice(0, 10)}`);
  lines.push(`Days active in the last 30: ${u.days_active_30}`);
  lines.push("");
  lines.push("Features (last 30 days / all time):");
  const width = Math.max(...Object.values(USAGE_EVENTS).map((l) => l.length));
  for (const [e, label] of Object.entries(USAGE_EVENTS) as Array<[UsageEvent, string]>) {
    const c = u.events[e];
    lines.push(`  ${label.padEnd(width)}  ${String(c.last_30).padStart(5)} / ${c.total}`);
  }
  const unused = (Object.keys(USAGE_EVENTS) as UsageEvent[]).filter((e) => u.events[e].total === 0).map((e) => USAGE_EVENTS[e].toLowerCase());
  if (unused.length && u.since) {
    lines.push("");
    lines.push(`Never used: ${unused.join("; ")}.`);
  }
  return lines.join("\n");
}
