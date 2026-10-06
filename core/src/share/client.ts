/**
 * Share links: upload one redacted report to app.postrun.app on purpose, and
 * get back an unlisted link that expires.
 *
 * - `postrun login` connects this computer to an account. A browser opens
 *   app.postrun.app/cli; approving it hands a one-time code back to a one-off
 *   listener on 127.0.0.1, which swaps it for a token by proving it started the
 *   login (PKCE). The token never passes through the browser. It is saved in
 *   ~/.postrun/account.json (owner only).
 * - Only the redacted HTML report is ever sent, the same file `postrun export`
 *   writes. Nothing else leaves this computer, and nothing is sent unless you
 *   ask for a link.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ensurePrivateDir, PRIVATE_FILE_MODE } from "../util/files.js";

export const DEFAULT_SHARE_SERVER = "https://app.postrun.app";
export const SHARE_EXPIRY_DAYS = [1, 7, 30, 90] as const;
export const DEFAULT_SHARE_EXPIRY_DAYS = 30;

export interface Account {
  server: string;
  token: string;
  email?: string;
  saved_at: string;
}

export class ShareFailed extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function accountFile(home: string): string {
  return join(home, "account.json");
}

/** Where share links are made. POSTRUN_SHARE_SERVER points at another (a local app.postrun.app while developing). */
export function shareServer(env: NodeJS.ProcessEnv = process.env, saved?: Account): string {
  const s = env["POSTRUN_SHARE_SERVER"]?.trim() || saved?.server || DEFAULT_SHARE_SERVER;
  return s.replace(/\/+$/, "");
}

export function readAccount(home: string): Account | undefined {
  try {
    const raw = JSON.parse(readFileSync(accountFile(home), "utf8")) as Partial<Account>;
    if (typeof raw.token !== "string" || typeof raw.server !== "string") return undefined;
    return { server: raw.server, token: raw.token, saved_at: String(raw.saved_at ?? ""), ...(typeof raw.email === "string" ? { email: raw.email } : {}) };
  } catch {
    return undefined;
  }
}

export function writeAccount(home: string, a: Account): void {
  ensurePrivateDir(home);
  const file = accountFile(home);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(a, null, 2) + "\n", { mode: PRIVATE_FILE_MODE });
  renameSync(tmp, file);
}

export function forgetAccount(home: string): void {
  if (existsSync(accountFile(home))) rmSync(accountFile(home), { force: true });
}

const looksLikeToken = (t: string) => /^prt_[A-Za-z0-9_-]{43}$/.test(t);

async function call(server: string, path: string, init: RequestInit & { token: string; userAgent: string }): Promise<Response> {
  const { token, userAgent, headers, ...rest } = init;
  try {
    return await fetch(`${server}${path}`, {
      ...rest,
      headers: { authorization: `Bearer ${token}`, "user-agent": userAgent, ...(headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new ShareFailed(`Couldn't reach ${server}. Check your connection and try again. (${(e as Error).message})`, "offline");
  }
}

async function failure(r: Response): Promise<ShareFailed> {
  let body: { error?: string; message?: string } = {};
  try {
    body = (await r.json()) as typeof body;
  } catch {
    // not JSON: fall through to a plain message
  }
  if (r.status === 401) return new ShareFailed("This computer isn't signed in to Postrun, or its sign-in was removed. Run: postrun login", "not_signed_in", 401);
  return new ShareFailed(body.message ?? `${r.status} ${r.statusText}`, body.error ?? "http_error", r.status);
}

/** Who a token belongs to. Throws ShareFailed("not_signed_in") when it no longer works. */
export async function whoAmI(server: string, token: string, userAgent: string): Promise<{ email: string; name: string }> {
  const r = await call(server, "/api/me", { method: "GET", token, userAgent });
  if (!r.ok) throw await failure(r);
  return (await r.json()) as { email: string; name: string };
}

/** Sign this computer out on the server too, so the token stops working everywhere. Best effort. */
export async function revokeOnServer(server: string, token: string, userAgent: string): Promise<boolean> {
  try {
    const r = await call(server, "/api/me", { method: "DELETE", token, userAgent });
    return r.ok || r.status === 401;
  } catch {
    return false;
  }
}

export interface ShareResult {
  id: string;
  url: string;
  title: string;
  expires_at: string;
}

export async function uploadReport(server: string, token: string, html: string, days: number, userAgent: string): Promise<ShareResult> {
  if (!(SHARE_EXPIRY_DAYS as readonly number[]).includes(days)) throw new ShareFailed(`A link can last ${SHARE_EXPIRY_DAYS.join(", ")} days.`, "bad_expiry");
  const body = gzipSync(Buffer.from(html, "utf8"), { level: 9 });
  const r = await call(server, `/api/shares?expires=${days}`, {
    method: "POST",
    token,
    userAgent,
    headers: { "content-type": "application/gzip" },
    body: new Uint8Array(body),
  });
  if (r.status !== 201) throw await failure(r);
  return (await r.json()) as ShareResult;
}

/** Feedback, with the computer's sign-in when it has one so a reply can reach the account. */
export async function sendFeedback(server: string, token: string | undefined, body: Record<string, unknown>, userAgent: string): Promise<void> {
  let r: Response;
  try {
    r = await fetch(`${server}/api/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": userAgent, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new ShareFailed(`Couldn't reach ${server}. Check your connection and try again. (${(e as Error).message})`, "offline");
  }
  if (r.status !== 201) {
    let b: { error?: string; message?: string } = {};
    try {
      b = (await r.json()) as typeof b;
    } catch {
      // not JSON
    }
    throw new ShareFailed(b.message ?? `${r.status} ${r.statusText}`, b.error ?? "http_error", r.status);
  }
}

export interface BrowserLogin {
  /** The page to open in a browser. */
  url: string;
  /** Resolves with the token once approved; rejects on cancel, error or timeout. */
  token: Promise<string>;
  close(): void;
}

const DONE_PAGE = (ok: boolean, msg: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><link rel="icon" href="data:,"><title>Postrun</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#08090c;color:#eceef3;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><div style="text-align:center;max-width:360px;padding:24px"><div style="width:44px;height:44px;margin:0 auto 16px;border-radius:50%;display:grid;place-items:center;background:${ok ? "rgba(74,222,128,.12)" : "rgba(248,113,113,.12)"};color:${ok ? "#4ade80" : "#f87171"};font-size:22px">${ok ? "&#10003;" : "&#10005;"}</div><h1 style="font-size:20px;margin:0 0 6px">${ok ? "Connected" : "Not connected"}</h1><p style="margin:0;color:#a3a9b7">${msg}</p></div></body></html>`;

/** Swap the one-time code from the browser for a token, with the secret only this process holds. */
export async function exchangeCode(server: string, code: string, verifier: string, userAgent: string): Promise<string> {
  let r: Response;
  try {
    r = await fetch(`${server}/api/cli/token`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": userAgent },
      body: JSON.stringify({ code, verifier }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new ShareFailed(`Couldn't reach ${server}. (${(e as Error).message})`, "offline");
  }
  if (!r.ok) throw await failure(r);
  const { token } = (await r.json()) as { token?: string };
  if (!token || !looksLikeToken(token)) throw new ShareFailed("Postrun sent back something unexpected. Run postrun login again.", "bad_token");
  return token;
}

/**
 * Start the one-off listener `postrun login` waits on. It answers a single
 * /callback carrying the state it made, swaps the code for a token, then stops.
 */
export async function startBrowserLogin(server: string, opts: { timeoutMs?: number; name?: string; userAgent?: string } = {}): Promise<BrowserLogin> {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const userAgent = opts.userAgent ?? "postrun";
  let settle: { ok: (t: string) => void; fail: (e: Error) => void } | undefined;
  const token = new Promise<string>((ok, fail) => (settle = { ok, fail }));
  let done = false;

  const srv = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (u.pathname !== "/callback" || done) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
      return;
    }
    if (u.searchParams.get("state") !== state) {
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(DONE_PAGE(false, "This link doesn't match the postrun login that's waiting. Run postrun login again."));
      return;
    }
    done = true;
    const code = u.searchParams.get("code") ?? "";
    const error = u.searchParams.get("error");
    const page = (ok: boolean, msg: string) =>
      res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" }).end(DONE_PAGE(ok, msg));
    const finish = () => setImmediate(() => srv.close());
    if (/^[A-Za-z0-9]{32}$/.test(code)) {
      exchangeCode(server, code, verifier, userAgent).then(
        (t) => {
          page(true, "This computer can now share sessions. You can close this tab.");
          settle?.ok(t);
          finish();
        },
        (e: Error) => {
          page(false, "Approved, but this computer couldn't finish signing in. Run postrun login again.");
          settle?.fail(e);
          finish();
        },
      );
      return;
    }
    const msg = error === "denied" ? "You cancelled. Nothing was connected." : error === "too_many_tokens" ? "Too many computers are connected. Remove one in Settings, then try again." : "Something went wrong. Run postrun login again.";
    page(false, msg);
    settle?.fail(new ShareFailed(msg, error ?? "bad_callback"));
    finish();
  });
  await new Promise<void>((ok, fail) => {
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => ok());
  });
  const port = (srv.address() as { port: number }).port;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    srv.close();
    settle?.fail(new ShareFailed("Timed out waiting for the browser. Run postrun login again.", "timeout"));
  }, opts.timeoutMs ?? 10 * 60_000);
  timer.unref();
  token.finally(() => clearTimeout(timer)).catch(() => undefined);

  const name = (opts.name ?? hostname()).slice(0, 60);
  const url = `${server}/cli?${new URLSearchParams({ port: String(port), state, challenge, name })}`;
  return {
    url,
    token,
    close: () => {
      done = true;
      clearTimeout(timer);
      srv.close();
    },
  };
}

export function validToken(t: string): boolean {
  return looksLikeToken(t);
}
