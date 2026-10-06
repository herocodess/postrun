/**
 * Rate limits for Postrun's own routes, kept in Postgres because every Vercel
 * function has its own memory. Better Auth limits its sign-in routes itself;
 * these add limits it doesn't have (per email address, per account) and cover
 * the share and CLI routes.
 *
 * Each limit is a fixed window: at most `max` hits per `seconds`. Keys are
 * hashed, so the table holds no IP address or email.
 */

import { createHash } from "node:crypto";
import { query } from "./db";
import { ShareError } from "./shares";

export interface Limit {
  /** What is being limited, e.g. "magic-link:email". */
  name: string;
  max: number;
  seconds: number;
}

export const LIMITS = {
  /** Sign-in emails to one address: stops anyone flooding an inbox with real Postrun emails. */
  emailPerAddress: { name: "magic-link:email", max: 5, seconds: 3600 },
  /** Sign-in emails from one IP address, to any address. */
  emailPerIp: { name: "magic-link:ip", max: 20, seconds: 3600 },
  /** Calls to the CLI API from one IP address. */
  apiPerIp: { name: "api:ip", max: 120, seconds: 60 },
  /** Requests with a wrong or removed token, per IP address: no guessing. */
  badTokenPerIp: { name: "api:bad-token", max: 20, seconds: 600 },
  /** Swapping login codes for tokens, per IP address. */
  codePerIp: { name: "cli:code", max: 10, seconds: 60 },
  /** Approving computers, per account. */
  connectPerUser: { name: "cli:connect", max: 10, seconds: 600 },
  /** Tokens made by hand in Settings, per account. */
  tokenPerUser: { name: "settings:token", max: 10, seconds: 3600 },
  /** Shared reports opened from one IP address. */
  viewPerIp: { name: "view:ip", max: 120, seconds: 60 },
} as const satisfies Record<string, Limit>;

const keyFor = (limit: Limit, subject: string) => createHash("sha256").update(`${limit.name}\u0000${subject.trim().toLowerCase()}`).digest("hex");

/** Count one hit. Returns whether it is allowed, and if not, how many seconds until it will be. */
export async function hit(limit: Limit, subject: string): Promise<{ ok: boolean; retryAfter: number }> {
  const [row] = await query<{ count: number; retry: number }>(
    `INSERT INTO rate_limit (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limit.window_start <= now() - make_interval(secs => $2) THEN 1 ELSE rate_limit.count + 1 END,
       window_start = CASE WHEN rate_limit.window_start <= now() - make_interval(secs => $2) THEN now() ELSE rate_limit.window_start END
     RETURNING count, ceil(extract(epoch FROM (window_start + make_interval(secs => $2) - now())))::int AS retry`,
    [keyFor(limit, subject), limit.seconds],
  );
  // Now and then, drop windows that ended long ago so the table stays small.
  if (Math.random() < 0.01) void query(`DELETE FROM rate_limit WHERE window_start < now() - interval '1 day'`).catch(() => undefined);
  const count = row?.count ?? 1;
  return { ok: count <= limit.max, retryAfter: Math.max(1, row?.retry ?? limit.seconds) };
}

/** Like hit(), but throws a 429 ShareError when over the limit. */
export async function enforce(limit: Limit, subject: string, message = "Too many requests. Wait a little, then try again."): Promise<void> {
  const r = await hit(limit, subject);
  if (!r.ok) throw new ShareError(429, "slow_down", `${message} (try again in ${r.retryAfter < 120 ? `${r.retryAfter} seconds` : `${Math.ceil(r.retryAfter / 60)} minutes`})`);
}

/** The caller's IP address. On Vercel x-real-ip and x-forwarded-for are set by Vercel itself, not the caller. */
export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
