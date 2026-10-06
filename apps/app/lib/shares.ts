/**
 * Share links: a redacted Postrun report uploaded on purpose, served at
 * /s/<id>. Unlisted (the id is the only way in), expiring, revocable, with an
 * open count. Turning a link off or letting it expire deletes the report itself;
 * only the row for the list stays.
 *
 * CLI tokens: how `postrun share` and the review app upload as you. Created by
 * `postrun login` (or by hand in Settings), stored as a SHA-256 hash.
 */

import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { query, tx } from "./db";
import { hashToken, looksLikeCliToken, newCliToken, randomId } from "./ids";

/** Vercel functions accept bodies up to 4.5 MB; reports are sent gzipped. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** A report this large is not a Postrun export, whatever it claims. */
export const MAX_REPORT_BYTES = 60 * 1024 * 1024;
export const EXPIRY_DAYS = [1, 7, 30, 90] as const;
export const DEFAULT_EXPIRY_DAYS = 30;
export const MAX_ACTIVE_SHARES = 200;
export const MAX_UPLOADS_PER_HOUR = 30;
export const MAX_TOKENS = 20;

export class ShareError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// ---- pure helpers (tested in shares.test.ts) ---------------------------------

export function parseExpiryDays(v: string | null | undefined): number {
  if (v === null || v === undefined || v === "") return DEFAULT_EXPIRY_DAYS;
  const n = Number(v);
  if (!(EXPIRY_DAYS as readonly number[]).includes(n)) throw new ShareError(400, "bad_expiry", `Expiry must be one of ${EXPIRY_DAYS.join(", ")} days.`);
  return n;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" };

/** The report's <title>, unescaped and trimmed for the list. */
export function reportTitle(html: string): string {
  const m = /<title>([^<]{0,400})<\/title>/i.exec(html.slice(0, 20_000));
  const raw = m?.[1] ?? "";
  const t = raw
    .replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, e: string) => ENTITIES[e] ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*·\s*postrun( report)?$/i, "");
  return (t || "Untitled session").slice(0, 200);
}

/** The agent named in the report, for the list badge. */
export function reportAgent(html: string): string | null {
  const m = /<meta name="postrun:agent" content="([a-z0-9-]{1,32})">/i.exec(html.slice(0, 20_000));
  return m?.[1] ?? null;
}

/**
 * Read an upload: gzip (what Postrun sends) or plain HTML. Checks it is an
 * HTML document of sensible size. It is served sandboxed either way, so this is
 * about keeping junk out, not about safety.
 */
export function readReport(body: Buffer, encoding: string | null): { gz: Buffer; html: string; size: number } {
  if (body.length === 0) throw new ShareError(400, "empty", "The upload was empty.");
  if (body.length > MAX_UPLOAD_BYTES) throw new ShareError(413, "too_large", "This report is too large to share (over 4 MB compressed).");
  const gzipped = encoding === "gzip" || (body[0] === 0x1f && body[1] === 0x8b);
  let raw: Buffer;
  try {
    raw = gzipped ? gunzipSync(body, { maxOutputLength: MAX_REPORT_BYTES }) : body;
  } catch {
    throw new ShareError(400, "bad_gzip", "The upload could not be decompressed, or it is too large.");
  }
  const html = raw.toString("utf8");
  if (!/^\s*<!doctype html>/i.test(html.slice(0, 200))) throw new ShareError(400, "not_html", "Only Postrun HTML reports can be shared.");
  return { gz: gzipped ? body : gzipSync(raw), html, size: raw.length };
}

// ---- shares --------------------------------------------------------------------

export interface ShareRow {
  id: string;
  title: string;
  agent: string | null;
  size_bytes: number;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  opens: number;
  last_opened_at: Date | null;
}

export type ShareStatus = "live" | "expired" | "off";

export function shareStatus(s: Pick<ShareRow, "expires_at" | "revoked_at">, now = new Date()): ShareStatus {
  if (s.revoked_at) return "off";
  if (s.expires_at.getTime() <= now.getTime()) return "expired";
  return "live";
}

const SHARE_COLS = "id, title, agent, size_bytes, created_at, expires_at, revoked_at, opens, last_opened_at";

/**
 * Delete the reports of expired links (the rows stay for the list). Cheap, with an
 * index on live reports, and run on every upload, list and viewer page.
 */
export async function sweepExpired(): Promise<void> {
  await query(`UPDATE share SET html_gz = NULL WHERE html_gz IS NOT NULL AND expires_at <= now()`);
}

export async function createShare(userId: string, report: { gz: Buffer; html: string; size: number }, days: number): Promise<ShareRow> {
  await sweepExpired();
  return tx(async (q) => {
    // One upload at a time per person, so parallel uploads can't slip past the limits.
    await q(`SELECT pg_advisory_xact_lock(hashtext('share:' || $1))`, [userId]);
    const [counts] = await q<{ active: string; recent: string }>(
      `SELECT count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()) AS active,
              count(*) FILTER (WHERE created_at > now() - interval '1 hour') AS recent
         FROM share WHERE user_id = $1`,
      [userId],
    );
    if (Number(counts?.recent ?? 0) >= MAX_UPLOADS_PER_HOUR) throw new ShareError(429, "slow_down", "That's a lot of shares in an hour. Try again later.");
    if (Number(counts?.active ?? 0) >= MAX_ACTIVE_SHARES) throw new ShareError(409, "too_many", `You have ${MAX_ACTIVE_SHARES} live links. Turn some off at app.postrun.app first.`);
    const [row] = await q<ShareRow>(
      `INSERT INTO share (id, user_id, title, agent, html_gz, size_bytes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))
       RETURNING ${SHARE_COLS}`,
      [randomId(16), userId, reportTitle(report.html), reportAgent(report.html), report.gz, report.size, days],
    );
    return row!;
  });
}

export async function listShares(userId: string): Promise<ShareRow[]> {
  await sweepExpired();
  return query<ShareRow>(`SELECT ${SHARE_COLS} FROM share WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`, [userId]);
}

/** Turn a link off: the report is deleted, the row stays so the list shows what happened. */
export async function revokeShare(userId: string, id: string): Promise<boolean> {
  const rows = await query(`UPDATE share SET revoked_at = coalesce(revoked_at, now()), html_gz = NULL WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
  return rows.length > 0;
}

export async function deleteShare(userId: string, id: string): Promise<boolean> {
  const rows = await query(`DELETE FROM share WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
  return rows.length > 0;
}

/** What the viewer page shows around the report. Doesn't count as an open. */
export async function shareForViewer(id: string): Promise<(Pick<ShareRow, "id" | "title" | "agent" | "created_at" | "expires_at" | "revoked_at"> & { available: boolean }) | undefined> {
  await sweepExpired();
  const [row] = await query<Pick<ShareRow, "id" | "title" | "agent" | "created_at" | "expires_at" | "revoked_at"> & { available: boolean }>(
    `SELECT id, title, agent, created_at, expires_at, revoked_at, (html_gz IS NOT NULL) AS available FROM share WHERE id = $1`,
    [id],
  );
  return row;
}

/** The report itself, counting one open. Undefined when the link is off, expired or unknown. */
export async function openReport(id: string): Promise<Buffer | undefined> {
  const [row] = await query<{ html_gz: Buffer }>(
    `UPDATE share SET opens = opens + 1, last_opened_at = now()
      WHERE id = $1 AND revoked_at IS NULL AND expires_at > now() AND html_gz IS NOT NULL
      RETURNING html_gz`,
    [id],
  );
  return row?.html_gz;
}

// ---- CLI tokens -------------------------------------------------------------------

export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  created_at: Date;
  last_used_at: Date | null;
}

export function tokenName(raw: string | null | undefined): string {
  const n = (raw ?? "")
    .replace(/[^\p{L}\p{N} ._()'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return n || "A computer";
}

export async function createToken(userId: string, name: string): Promise<{ token: string; row: TokenRow }> {
  return tx(async (q) => {
    await q(`SELECT pg_advisory_xact_lock(hashtext('token:' || $1))`, [userId]);
    const [n] = await q<{ c: string }>(`SELECT count(*) AS c FROM cli_token WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    if (Number(n?.c ?? 0) >= MAX_TOKENS) throw new ShareError(409, "too_many_tokens", `You have ${MAX_TOKENS} computers signed in. Remove one in Settings first.`);
    const t = newCliToken();
    const [row] = await q<TokenRow>(
      `INSERT INTO cli_token (id, user_id, name, token_hash, prefix) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, prefix, created_at, last_used_at`,
      [randomId(16), userId, tokenName(name), t.hash, t.prefix],
    );
    return { token: t.token, row: row! };
  });
}

export async function listTokens(userId: string): Promise<TokenRow[]> {
  return query<TokenRow>(`SELECT id, name, prefix, created_at, last_used_at FROM cli_token WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`, [userId]);
}

export async function revokeToken(userId: string, id: string): Promise<boolean> {
  const rows = await query(`UPDATE cli_token SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`, [id, userId]);
  return rows.length > 0;
}

export interface TokenUser {
  token_id: string;
  user_id: string;
  email: string;
  name: string;
}

/** The person a `Authorization: Bearer prt_…` header belongs to. */
export async function userForToken(authorization: string | null): Promise<TokenUser | undefined> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  const token = m?.[1];
  if (!token || !looksLikeCliToken(token)) return undefined;
  const [row] = await query<TokenUser>(
    `UPDATE cli_token t SET last_used_at = now()
       FROM "user" u
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND u.id = t.user_id
      RETURNING t.id AS token_id, t.user_id, u.email, u.name`,
    [hashToken(token)],
  );
  return row;
}

export async function revokeTokenById(tokenId: string): Promise<void> {
  await query(`UPDATE cli_token SET revoked_at = now() WHERE id = $1`, [tokenId]);
}

// ---- postrun login: one-time codes ------------------------------------------------

/** A PKCE challenge: base64url SHA-256 of the secret the computer keeps. */
export const isChallenge = (c: string) => /^[A-Za-z0-9_-]{43}$/.test(c);
export const isCliCode = (c: string) => /^[A-Za-z0-9]{32}$/.test(c);

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** After someone approves a computer: a code that only that computer can turn into a token. */
export async function createCliCode(userId: string, name: string, challenge: string): Promise<string> {
  if (!isChallenge(challenge)) throw new ShareError(400, "bad_challenge", "This sign-in link is broken. Run postrun login again.");
  const code = randomId(32);
  await query(`DELETE FROM cli_code WHERE expires_at < now() - interval '1 day'`);
  await query(`INSERT INTO cli_code (code_hash, user_id, name, challenge, expires_at) VALUES ($1, $2, $3, $4, now() + interval '2 minutes')`, [
    hashToken(code),
    userId,
    tokenName(name),
    challenge,
  ]);
  return code;
}

/** The computer's half: the code plus the secret behind the challenge. Works once, within two minutes. */
export async function exchangeCliCode(code: string, verifier: string): Promise<string> {
  if (!isCliCode(code) || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) throw new ShareError(400, "bad_code", "That sign-in code isn't valid. Run postrun login again.");
  const [row] = await query<{ user_id: string; name: string; challenge: string }>(
    `UPDATE cli_code SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id, name, challenge`,
    [hashToken(code)],
  );
  if (!row || row.challenge !== challengeFor(verifier)) throw new ShareError(400, "bad_code", "That sign-in code has expired or was already used. Run postrun login again.");
  return (await createToken(row.user_id, row.name)).token;
}
