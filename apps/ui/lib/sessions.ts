/**
 * Fetching the session list a page at a time, with filters. The server does
 * the filtering and paging (GET /api/sessions); the static demo has one JSON
 * file, so there the same filters run here instead.
 */

import type { SessionListResponse } from "@postrun/core/server/api";
import type { SessionSummary } from "@postrun/core/store";
import { api, apiFetch, DEMO } from "@/lib/api";

export const PAGE_SIZE = 50;

export type Range = "all" | "today" | "7d" | "30d" | "custom";
export type Size = 0 | 10 | 100;

export interface ListFilters {
  agent: string;
  q: string;
  range: Range;
  /** yyyy-mm-dd, for a custom range. */
  from: string;
  to: string;
  /** Minimum steps. */
  size: Size;
  failed: boolean;
  empty: boolean;
  /** Review state: any, not reviewed yet, Looks good, Needs follow-up. */
  review: Review;
  /** Only sessions with risk flags. */
  flagged: boolean;
  /** Only this working folder (a project page). */
  workspace: string;
}

export type Review = "any" | "none" | "approved" | "needs_attention";

export const NO_FILTERS: Omit<ListFilters, "agent" | "workspace"> = { q: "", range: "all", from: "", to: "", size: 0, failed: false, empty: false, review: "any", flagged: false };

/** How many filters (beyond the agent tabs) are narrowing the list. */
export function activeFilters(f: ListFilters): number {
  const dated = f.range !== "all" && (f.range !== "custom" || Boolean(f.from || f.to));
  return (f.q.trim() ? 1 : 0) + (dated ? 1 : 0) + (f.size > 0 ? 1 : 0) + (f.failed ? 1 : 0) + (f.review !== "any" ? 1 : 0) + (f.flagged ? 1 : 0);
}

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The range as ISO bounds in local time: from is inclusive, to is exclusive. */
export function rangeBounds(f: Pick<ListFilters, "range" | "from" | "to">, now = new Date()): { from?: string; to?: string } {
  const today = midnight(now);
  const days = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n).toISOString();
  switch (f.range) {
    case "today":
      return { from: today.toISOString() };
    case "7d":
      return { from: days(6) };
    case "30d":
      return { from: days(29) };
    case "custom": {
      const out: { from?: string; to?: string } = {};
      if (f.from) out.from = new Date(`${f.from}T00:00:00`).toISOString();
      if (f.to) {
        const end = new Date(`${f.to}T00:00:00`);
        out.to = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).toISOString();
      }
      return out;
    }
    default:
      return {};
  }
}

function params(f: ListFilters, limit: number, cursor?: string): URLSearchParams {
  const p = new URLSearchParams();
  if (f.agent) p.set("agent", f.agent);
  if (f.q.trim()) p.set("q", f.q.trim());
  const { from, to } = rangeBounds(f);
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  if (f.size) p.set("min_steps", String(f.size));
  if (f.failed) p.set("failed", "1");
  if (f.flagged) p.set("flagged", "1");
  if (f.review !== "any") p.set("verdict", f.review);
  if (f.workspace) p.set("workspace", f.workspace);
  if (!f.empty) p.set("empty", "0");
  p.set("limit", String(limit));
  if (cursor) p.set("cursor", cursor);
  return p;
}

export async function fetchSessions(f: ListFilters, limit: number, cursor?: string): Promise<SessionListResponse> {
  if (DEMO) return demoPage(f, limit, cursor);
  const res = await apiFetch(`${api.sessionsBase()}?${params(f, limit, cursor)}`);
  if (!res.ok) throw new Error(`GET /api/sessions -> ${res.status}`);
  const data = (await res.json()) as Partial<SessionListResponse> & Pick<SessionListResponse, "sessions" | "agents">;
  // A Postrun older than paging answers with every session and no totals: fill them in.
  return {
    ...data,
    total: data.total ?? data.sessions.length,
    total_cost: data.total_cost ?? data.sessions.reduce((n, s) => n + s.metrics.cost_usd, 0),
    empty_count: data.empty_count ?? 0,
  };
}

/** The demo's one JSON file, filtered and paged the way the server would. */
async function demoPage(f: ListFilters, limit: number, cursor?: string): Promise<SessionListResponse> {
  const res = await apiFetch(api.sessionsBase());
  if (!res.ok) throw new Error(`demo sessions -> ${res.status}`);
  const all = ((await res.json()) as SessionListResponse).sessions;
  const { from, to } = rangeBounds(f);
  const q = f.q.trim().toLowerCase();
  const match = (s: SessionSummary, withEmpty: boolean) =>
    (!f.agent || s.agent.kind === f.agent) &&
    (!q || (s.title ?? "").toLowerCase().includes(q) || s.workspace.root.toLowerCase().includes(q) || s.id.startsWith(q)) &&
    (!from || s.started_at >= from) &&
    (!to || s.started_at < to) &&
    s.steps_total >= f.size &&
    (!f.failed || s.failed_count > 0) &&
    (!f.flagged || s.flag_count > 0) &&
    (!f.workspace || s.workspace.root === f.workspace) &&
    (f.review === "any" || (f.review === "none" ? !s.verdict : s.verdict?.state === f.review)) &&
    (withEmpty || s.steps_total > 0);
  const hits = all.filter((s) => match(s, f.empty));
  const start = cursor ? Number(cursor) : 0;
  const page = hits.slice(start, start + limit);
  return {
    sessions: page,
    agents: [...new Set(all.map((s) => s.agent.kind))].sort(),
    total: hits.length,
    total_cost: hits.reduce((n, s) => n + s.metrics.cost_usd, 0),
    empty_count: all.filter((s) => match(s, true) && s.steps_total === 0).length,
    ...(start + limit < hits.length ? { next_cursor: String(start + limit) } : {}),
  };
}
