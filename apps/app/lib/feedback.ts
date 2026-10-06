/**
 * Feedback: a rating from 1 to 5, a message, or both, sent on purpose from the
 * review app, `postrun feedback` or this site. Stored in Postgres, with an email
 * to the admins for each one. No IP address is stored.
 */

import { query } from "./db";
import { randomId } from "./ids";
import { ShareError } from "./shares";

export const FEEDBACK_SOURCES = ["review-app", "cli", "app"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

export interface FeedbackInput {
  rating?: number;
  message?: string;
  email?: string;
  source: FeedbackSource;
  version?: string;
  platform?: string;
  usage?: string;
}

export interface FeedbackRow {
  id: string;
  created_at: Date;
  user_id: string | null;
  account_email: string | null;
  email: string | null;
  rating: number | null;
  message: string | null;
  source: FeedbackSource;
  version: string | null;
  platform: string | null;
  usage: string | null;
  status: "new" | "done";
}

const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return s ? s.slice(0, max) : undefined;
};

/** Check and tidy what was sent. Throws a 400 ShareError on anything unusable. */
export function readFeedback(body: unknown): FeedbackInput {
  if (!body || typeof body !== "object") throw new ShareError(400, "bad_feedback", "Send JSON: { rating, message }.");
  const b = body as Record<string, unknown>;
  const rating = b["rating"] === undefined || b["rating"] === null ? undefined : Number(b["rating"]);
  if (rating !== undefined && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw new ShareError(400, "bad_rating", "A rating is a whole number from 1 to 5.");
  const message = clean(b["message"], 4000);
  if (rating === undefined && !message) throw new ShareError(400, "empty", "Add a rating or a few words.");
  const source = FEEDBACK_SOURCES.includes(b["source"] as FeedbackSource) ? (b["source"] as FeedbackSource) : "app";
  const email = clean(b["email"], 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ShareError(400, "bad_email", "That email address doesn't look right.");
  const out: FeedbackInput = { source };
  if (rating !== undefined) out.rating = rating;
  if (message) out.message = message;
  if (email) out.email = email;
  const version = clean(b["version"], 40);
  if (version) out.version = version;
  const platform = clean(b["platform"], 60);
  if (platform) out.platform = platform;
  const usage = clean(b["usage"], 6000);
  if (usage) out.usage = usage;
  return out;
}

export async function saveFeedback(input: FeedbackInput, userId?: string): Promise<FeedbackRow> {
  const [row] = await query<FeedbackRow>(
    `WITH ins AS (
       INSERT INTO feedback (id, user_id, email, rating, message, source, version, platform, usage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
     )
     SELECT ins.*, u.email AS account_email FROM ins LEFT JOIN "user" u ON u.id = ins.user_id`,
    [randomId(16), userId ?? null, input.email ?? null, input.rating ?? null, input.message ?? null, input.source, input.version ?? null, input.platform ?? null, input.usage ?? null],
  );
  return row!;
}

export interface FeedbackFilter {
  source?: FeedbackSource;
  status?: "new" | "done";
  rating?: number;
}

export async function listFeedback(f: FeedbackFilter = {}, limit = 200): Promise<FeedbackRow[]> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (f.source) where.push(`f.source = $${vals.push(f.source)}`);
  if (f.status) where.push(`f.status = $${vals.push(f.status)}`);
  if (f.rating) where.push(`f.rating = $${vals.push(f.rating)}`);
  return query<FeedbackRow>(
    `SELECT f.*, u.email AS account_email FROM feedback f LEFT JOIN "user" u ON u.id = f.user_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY f.created_at DESC LIMIT ${Math.min(500, Math.max(1, limit))}`,
    vals,
  );
}

export interface FeedbackStats {
  total: number;
  last_30: number;
  open: number;
  average: number | null;
  average_30: number | null;
  ratings: Record<1 | 2 | 3 | 4 | 5, number>;
  users: number;
}

export async function feedbackStats(): Promise<FeedbackStats> {
  const [s] = await query<{ total: string; last_30: string; open: string; average: string | null; average_30: string | null; users: string; r1: string; r2: string; r3: string; r4: string; r5: string }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE created_at > now() - interval '30 days') AS last_30,
            count(*) FILTER (WHERE status = 'new') AS open,
            round(avg(rating)::numeric, 2) AS average,
            round((avg(rating) FILTER (WHERE created_at > now() - interval '30 days'))::numeric, 2) AS average_30,
            count(DISTINCT coalesce(user_id, email)) AS users,
            count(*) FILTER (WHERE rating = 1) AS r1, count(*) FILTER (WHERE rating = 2) AS r2, count(*) FILTER (WHERE rating = 3) AS r3,
            count(*) FILTER (WHERE rating = 4) AS r4, count(*) FILTER (WHERE rating = 5) AS r5
       FROM feedback`,
  );
  const n = (v: string | undefined) => Number(v ?? 0);
  return {
    total: n(s?.total),
    last_30: n(s?.last_30),
    open: n(s?.open),
    average: s?.average === null || s?.average === undefined ? null : Number(s.average),
    average_30: s?.average_30 === null || s?.average_30 === undefined ? null : Number(s.average_30),
    users: n(s?.users),
    ratings: { 1: n(s?.r1), 2: n(s?.r2), 3: n(s?.r3), 4: n(s?.r4), 5: n(s?.r5) },
  };
}

export async function setFeedbackStatus(id: string, status: "new" | "done"): Promise<void> {
  await query(`UPDATE feedback SET status = $2 WHERE id = $1`, [id, status]);
}
