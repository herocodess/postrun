/**
 * Localhost-only HTTP server over the session store.
 *
 * Security default: binds to 127.0.0.1 only. There is no option to bind
 * elsewhere; the host is not configurable on purpose.
 *
 * Reads from the SQLite store; it never runs adapters. Ingest first with
 * `pnpm ingest`.
 *
 *   GET  /api/sessions[?agent=kind]  history list, newest first
 *   GET  /api/sessions/:id           one session (step previews) plus report projections
 *   GET  /api/sessions/:id?since=t   only the steps written after t, for live views
 *   GET  /api/sessions/:id/steps/:s  one step in full
 *   DELETE /api/sessions/:id         delete a session and its raw capture files (same-origin only)
 *   GET  /api/sessions/:id/export    redacted, self-contained HTML report (download)
 *   GET  /api/sessions/:id/export/review   what that export would mask, as JSON
 *   POST /api/sessions/:id/share     upload that export to app.postrun.app, return the link (same-origin only)
 *   GET  /api/account                whether this computer is signed in for share links
 *   POST /api/ingest                 push a v1.2 batch (bearer token; see ingest.ts, token.ts)
 *   GET  /api/events[?session=id]    live change stream, server-sent events (see live.ts)
 *   GET  /                           the built UI (apps/ui/out)
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { exportSession } from "../export/index.js";
import { sessionReport } from "../report/index.js";
import { isSafeId, sessionDir } from "../capture/layout.js";
import { BadCursorError, DeletedSessionError, MAX_PAGE, PostrunStore, type SessionQuery } from "../store/index.js";
import { isLoopbackHost } from "../util/host.js";
import { zip } from "../util/zip.js";
import type {
  AccountResponse,
  ApiError,
  AppControl,
  AppSettings,
  DeleteAllResponse,
  DeleteSessionResponse,
  DoctorResponse,
  ProjectFilesResponse,
  ProjectsResponse,
  VerdictResponse,
  ExportReviewResponse,
  IngestErrorResponse,
  IngestResponse,
  SessionDeltaResponse,
  SessionDetailResponse,
  SessionListResponse,
  ShareResponse,
  FeedbackPayload,
  StepResponse,
  UsageResponse,
} from "./api.js";
import { previewStep } from "./preview.js";
import { checkIngest, MAX_INGEST_BYTES } from "./ingest.js";
import { LiveFeed, SSE_HEADERS, type LiveFeedOptions } from "./live.js";
import { bearerMatches, loadOrCreateToken } from "./token.js";
import { CLIENT_USAGE_EVENTS, formatUsage, isUsageEvent, type UsageEvent } from "../store/usage.js";
import { pipeline } from "node:stream";

/**
 * The review app's content security policy. Next's static export needs inline scripts and styles;
 * everything else comes from this origin only. frame-ancestors 'none' stops other sites framing
 * the app to trick a click (pausing recording, say).
 */
export const UI_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; " +
  "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

/** Sent on every response. No CORS headers are ever set: only same-origin pages may read the API. */
const BASE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "content-security-policy": UI_CSP,
} as const;

export const LOCALHOST = "127.0.0.1";
export const DEFAULT_PORT = 1234;

export interface ServerOptions {
  /** Port to listen on. 0 picks an ephemeral port (tests). */
  port: number;
  /** Directory holding the built UI (index.html + assets). */
  uiDir: string;
  /** An open store to serve. Takes precedence over dbPath. Not closed by stop(). */
  store?: PostrunStore;
  /** SQLite file to open when no store is given. Default ~/.postrun/postrun.db. Closed by stop(). */
  dbPath?: string;
  /** Bearer token for POST /api/ingest. Default: read or create ~/.postrun/ingest-token. */
  ingestToken?: string;
  /**
   * When true, every /api route except /api/health and /api/ingest also needs the token, as
   * `Authorization: Bearer <token>` or `?key=<token>` (downloads and the live stream, which cannot
   * set headers). Keeps other accounts on a shared computer out. The background process and
   * `postrun serve` turn it on; `postrun open` hands the key to the browser in the URL fragment.
   */
  requireKey?: boolean;
  /** Live feed tuning (poll interval, heartbeat, client cap). Tests shorten these. */
  live?: LiveFeedOptions;
  /** Capture folder whose per-session raw files a delete also removes. Default POSTRUN_CAPTURE_DIR or ~/.postrun/captures. */
  captureDir?: string;
  /** Extra fields for GET /api/health, such as the version and pid of the background process. */
  health?: Record<string, unknown>;
  /** Status, settings and maintenance, provided by the background process. Without it those routes answer 501. */
  control?: AppControl;
}

export interface PostrunServer {
  server: Server;
  store: PostrunStore;
  live: LiveFeed;
  /** Resolves with the bound port once listening. Rejects with a friendly Error on EADDRINUSE. */
  start(): Promise<{ host: string; port: number; url: string }>;
  stop(): Promise<void>;
}

export class PortInUseError extends Error {
  constructor(public readonly port: number) {
    super(
      `Port ${port} is already in use on ${LOCALHOST}. ` +
        `Pick another port with --port <n> or PORT=<n> (default ${DEFAULT_PORT}).`,
    );
    this.name = "PortInUseError";
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export function createPostrunServer(opts: ServerOptions): PostrunServer {
  const ownsStore = !opts.store;
  const store = opts.store ?? new PostrunStore(opts.dbPath !== undefined ? { path: opts.dbPath } : {});
  const uiRoot = resolve(opts.uiDir);
  const ingestToken = opts.ingestToken ?? loadOrCreateToken();
  const live = new LiveFeed(store, opts.live);
  const captureDir = opts.captureDir ?? process.env["POSTRUN_CAPTURE_DIR"] ?? join(homedir(), ".postrun", "captures");

  const server = createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res, { store, uiRoot, ingestToken, requireKey: opts.requireKey === true, live, captureDir, health: opts.health ?? {}, ...(opts.control ? { control: opts.control } : {}) }))
      .catch((err: unknown) => {
        // Never echo internal error text (paths, SQL) to the client.
        // The path only: a query can carry the key (?key=), which never belongs in a log.
        process.stderr.write(`postrun server: ${req.method ?? ""} ${(req.url ?? "").split("?")[0]}: ${(err as Error).message}\n`);
        if (!res.headersSent) json(res, 500, { error: "internal error" });
        else res.destroy();
      });
  });

  const start = () =>
    new Promise<{ host: string; port: number; url: string }>((resolvePromise, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        reject(err.code === "EADDRINUSE" ? new PortInUseError(opts.port) : err);
      };
      const onListening = () => {
        server.off("error", onError);
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("server did not bind to a TCP address"));
          return;
        }
        resolvePromise({ host: addr.address, port: addr.port, url: `http://${addr.address}:${addr.port}/` });
      };
      server.once("error", onError);
      server.once("listening", onListening);
      // Host is hard-coded: never 0.0.0.0, never a public interface.
      server.listen(opts.port, LOCALHOST);
    });

  const stop = () =>
    new Promise<void>((resolvePromise, reject) => {
      // Event streams never end on their own; close them so server.close() can finish.
      live.close();
      server.close((err) => {
        if (ownsStore) store.close();
        if (err) reject(err);
        else resolvePromise();
      });
      server.closeIdleConnections();
    });

  return { server, store, live, start, stop };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Count a feature use locally. Counting must never fail a request. */
function count(ctx: Ctx, event: UsageEvent): void {
  try {
    ctx.store.countUsage(event);
  } catch {
    // a busy store skips one count; nothing else depends on it
  }
}

/** The key as a bearer header, or as ?key= for downloads and the live stream. Compared in constant time. */
function hasKey(req: IncomingMessage, url: URL, token: string): boolean {
  if (bearerMatches(req.headers.authorization, token)) return true;
  const q = url.searchParams.get("key");
  return q !== null && q.length > 0 && bearerMatches(`Bearer ${q}`, token);
}

function text(res: ServerResponse, status: number, body: string, extra: Record<string, string | number> = {}): void {
  res.writeHead(status, { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8", ...extra });
  res.end(body);
}

interface Ctx {
  store: PostrunStore;
  uiRoot: string;
  ingestToken: string;
  requireKey: boolean;
  live: LiveFeed;
  captureDir: string;
  health: Record<string, unknown>;
  control?: AppControl;
}

async function handle(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const { store, uiRoot } = ctx;
  const method = req.method ?? "GET";

  // DNS rebinding guard: the socket is loopback, the Host header must be too.
  if (!isLoopbackHost(req.headers.host)) {
    text(res, 421, "misdirected request: this server only answers to 127.0.0.1 or localhost\n");
    return;
  }

  let url: URL;
  try {
    url = new URL(req.url ?? "/", `http://${LOCALHOST}`);
    decodeURIComponent(url.pathname); // malformed percent-encoding is a client error, not a 500
  } catch {
    text(res, 400, "bad request\n");
    return;
  }

  if (url.pathname === "/api/health" && (method === "GET" || method === "HEAD")) {
    json(res, 200, { ok: true, ...ctx.health });
    return;
  }

  // The one write route. Everything else is read-only.
  if (url.pathname === "/api/ingest") {
    if (method !== "POST") {
      text(res, 405, "method not allowed\n", { allow: "POST" });
      return;
    }
    await handleIngest(req, res, ctx);
    return;
  }

  // Everything else under /api needs the key when the server asks for one.
  if (ctx.requireKey && url.pathname.startsWith("/api/") && !hasKey(req, url, ctx.ingestToken)) {
    json(res, 401, { error: "this browser is not connected: run postrun open in a terminal" } satisfies ApiError);
    return;
  }

  const del = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
  if (del && method === "DELETE") {
    // The only destructive route. A page on another site cannot reach it: DELETE needs a CORS preflight,
    // which this server never answers, and requests a browser marks as cross-site are refused outright.
    if (!sameOrigin(req)) {
      json(res, 403, { error: "cross-site request refused" } satisfies ApiError);
      return;
    }
    const id = decodeURIComponent(del[1] as string);
    const gone = store.deleteSession(id);
    if (!gone) {
      json(res, 404, { error: `session ${id} not found` } satisfies ApiError);
      return;
    }
    let removed_capture_files = false;
    if (gone.agent_kind === "claude-code" && isSafeId(id)) {
      const dir = sessionDir(ctx.captureDir, id);
      removed_capture_files = existsSync(dir);
      rmSync(dir, { recursive: true, force: true });
    }
    ctx.live.nudge();
    json(res, 200, { deleted: true, id, agent_kind: gone.agent_kind, removed_capture_files } satisfies DeleteSessionResponse);
    return;
  }

  // The app's own writes: same origin only, JSON bodies only (so a cross-site page cannot send one without a preflight).
  if (method === "PUT" || method === "POST") {
    if (await handleAppWrite(req, res, url, method, ctx)) return;
  }

  if (method !== "GET" && method !== "HEAD") {
    text(res, 405, "method not allowed\n", { allow: del ? "GET, HEAD, DELETE" : "GET, HEAD" });
    return;
  }

  if (await handleAppRead(req, res, url, method, ctx)) return;

  if (url.pathname === "/api/events") {
    const session = url.searchParams.get("session") ?? undefined;
    if (ctx.live.clientCount >= ctx.live.maxClients) {
      json(res, 503, { error: "too many live connections" });
      return;
    }
    res.writeHead(200, { ...BASE_HEADERS, ...SSE_HEADERS });
    if (method === "HEAD") {
      res.end();
      return;
    }
    res.flushHeaders();
    ctx.live.attach(res, session);
    return;
  }

  if (url.pathname === "/api/sessions") {
    let query: SessionQuery;
    try {
      query = sessionQuery(url.searchParams);
    } catch (err) {
      json(res, 400, { error: (err as Error).message } satisfies ApiError);
      return;
    }
    let page;
    try {
      page = store.querySessions(query);
      // One search per query typed, not per page of results.
      if (query.q && !query.cursor) count(ctx, "search");
    } catch (err) {
      if (err instanceof BadCursorError) {
        json(res, 400, { error: "invalid cursor" } satisfies ApiError);
        return;
      }
      throw err;
    }
    const body: SessionListResponse = { ...page, agents: store.agentKinds() };
    json(res, 200, body);
    return;
  }

  const m = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
  if (m) {
    const id = decodeURIComponent(m[1] as string);
    const since = url.searchParams.get("since");
    if (since) {
      // Live view: everything small, plus only the steps written after `since`.
      const full = store.getSessionShell(id);
      if (!full) {
        json(res, 404, { error: `session ${id} not found` } satisfies ApiError);
        return;
      }
      const delta = store.stepsChangedSince(id, since);
      const body: SessionDeltaResponse = {
        ...full,
        // step_ids would resend every step id in the session on every update; a delta leaves them empty.
        turns: full.turns.map((t) => ({ ...t, step_ids: [] })),
        delta: true,
        reload: delta.reload,
        steps: delta.steps.map(previewStep),
        report: sessionReport(store.reportSteps(id)),
        as_of: full.summary.updated_at,
      };
      json(res, 200, body);
      return;
    }
    const session = store.getSession(id);
    if (!session) {
      const body: ApiError = { error: `session ${id} not found` };
      json(res, 404, body);
      return;
    }
    const body: SessionDetailResponse = { ...session, steps: session.steps.map(previewStep), report: sessionReport(session.steps), as_of: session.summary.updated_at };
    json(res, 200, body);
    return;
  }

  const st = /^\/api\/sessions\/([^/]+)\/steps\/([^/]+)$/.exec(url.pathname);
  if (st) {
    const step = store.getStep(decodeURIComponent(st[1] as string), decodeURIComponent(st[2] as string));
    if (!step) {
      json(res, 404, { error: "step not found" } satisfies ApiError);
      return;
    }
    json(res, 200, { step } satisfies StepResponse);
    return;
  }

  const ex = /^\/api\/sessions\/([^/]+)\/export(\/review)?$/.exec(url.pathname);
  if (ex) {
    const id = decodeURIComponent(ex[1] as string);
    const session = store.getSession(id);
    if (!session) {
      json(res, 404, { error: `session ${id} not found` } satisfies ApiError);
      return;
    }
    const result = exportSession(session);
    if (ex[2]) {
      const body: ExportReviewResponse = { filename: result.filename, bytes: Buffer.byteLength(result.html), redaction: result.redaction };
      json(res, 200, body);
      return;
    }
    const html = Buffer.from(result.html, "utf8");
    if (method === "GET") count(ctx, "report_exported");
    res.writeHead(200, {
      ...BASE_HEADERS,
      "content-type": "text/html; charset=utf-8",
      "content-length": html.byteLength,
      // A download, never rendered from this origin: the file is meant to be opened elsewhere.
      "content-disposition": `attachment; filename="${result.filename}"`,
      "content-security-policy": "sandbox",
    });
    res.end(method === "HEAD" ? undefined : html);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    json(res, 404, { error: "not found" });
    return;
  }

  serveStatic(url.pathname, res, uiRoot, method === "HEAD");
}

async function handleIngest(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const { store, ingestToken: token } = ctx;
  const fail = (status: number, body: IngestErrorResponse, extra: Record<string, string> = {}) => {
    res.writeHead(status, { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", ...extra });
    res.end(JSON.stringify(body));
  };

  // Auth first, so an unauthenticated caller never gets the body parsed.
  if (!bearerMatches(req.headers.authorization, token)) {
    req.resume();
    fail(401, { error: "missing or invalid bearer token (see ~/.postrun/ingest-token)" }, { "www-authenticate": 'Bearer realm="postrun"' });
    return;
  }
  const ct = req.headers["content-type"] ?? "";
  if (!/^application\/json\s*(;|$)/i.test(ct)) {
    req.resume();
    fail(415, { error: `content-type must be application/json, got ${ct || "none"}` });
    return;
  }
  const encoding = (req.headers["content-encoding"] ?? "identity").toLowerCase();
  if (encoding !== "identity" && encoding !== "gzip") {
    req.resume();
    fail(415, { error: `unsupported content-encoding ${encoding}; use gzip or none` });
    return;
  }
  if (Number(req.headers["content-length"] ?? 0) > MAX_INGEST_BYTES) {
    fail(413, { error: `body larger than ${MAX_INGEST_BYTES} bytes` }, { connection: "close" });
    dropAfterReply(req);
    return;
  }

  let raw = await readBody(req, MAX_INGEST_BYTES);
  if (raw === "too_large") {
    fail(413, { error: `body larger than ${MAX_INGEST_BYTES} bytes` }, { connection: "close" });
    dropAfterReply(req);
    return;
  }
  if (encoding === "gzip") {
    try {
      // maxOutputLength bounds decompression so a small gzip body cannot expand without limit.
      raw = gunzipSync(raw, { maxOutputLength: MAX_INGEST_BYTES });
    } catch (err) {
      const tooBig = (err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE";
      fail(tooBig ? 413 : 400, { error: tooBig ? `decompressed body larger than ${MAX_INGEST_BYTES} bytes` : "invalid gzip body" });
      return;
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    fail(400, { error: "body is not valid JSON" });
    return;
  }

  // Check and write run synchronously with no await between them, so no other
  // request can change the session's refs in between.
  const checked = checkIngest(body, store);
  if (!checked.ok) {
    const out: IngestErrorResponse = { error: checked.error };
    if (checked.details) out.details = checked.details;
    if (checked.omitted) out.omitted = checked.omitted;
    fail(checked.status, out);
    return;
  }
  let appended;
  try {
    appended = store.appendBatch(checked.batch);
  } catch (err) {
    if (err instanceof DeletedSessionError) {
      fail(410, { error: err.message } satisfies IngestErrorResponse);
      return;
    }
    throw err;
  }
  const { changed: _changed, written: _written, missing_content: _missing, ...rest } = appended;
  const result: IngestResponse = rest;
  json(res, result.created ? 201 : 200, result);
  ctx.live.nudge();
}

/**
 * True unless the browser says the request comes from another site. Sec-Fetch-Site is sent by every
 * current browser; Origin, when present, must name this server. Non-browser clients (curl, the CLI)
 * send neither and are allowed: they are already on this machine.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers["origin"];
  if (origin === undefined) return true;
  try {
    const o = new URL(origin);
    return isLoopbackHost(o.host) && o.host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * After refusing an oversized body: let the answer reach the client, then hang up. Cutting the
 * connection straight away can kill the reply while the client is still sending (macOS reports
 * EPIPE and the caller never sees the 413). The rest of the body is read and thrown away, but
 * never more than 16 MB or for longer than 2 seconds.
 */
function dropAfterReply(req: IncomingMessage): void {
  let drained = 0;
  const hangUp = () => {
    clearTimeout(timer);
    if (!req.destroyed) req.destroy();
  };
  const timer = setTimeout(hangUp, 2000);
  timer.unref();
  req.on("data", (c: Buffer) => {
    drained += c.length;
    if (drained > 16 * 1024 * 1024) hangUp();
  });
  req.on("end", hangUp);
  req.resume();
}

/** Read a request body up to max bytes. Resolves "too_large" as soon as the limit is crossed. */
function readBody(req: IncomingMessage, max: number): Promise<Buffer | "too_large"> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > max) {
        done = true;
        resolvePromise("too_large");
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!done) {
        done = true;
        resolvePromise(Buffer.concat(chunks));
      }
    });
    req.on("error", (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
  });
}

/** Resolve a request path to a file under the UI root. Extensionless paths map to Next's static export (<name>.html). */
function resolveStatic(pathname: string, uiRoot: string): string | undefined {
  const rel = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  // "/settings/" and "/settings" are the same page: drop the trailing slash before adding ".html".
  const bare = rel.length > 1 ? rel.replace(/\/+$/, "") : rel;
  const candidates = extname(bare) ? [bare] : [`${bare}.html`, join(bare, "index.html")];
  for (const c of candidates) {
    const filePath = resolve(uiRoot, "." + c);
    // Path traversal guard: the resolved file must live under the UI directory.
    if (filePath !== uiRoot && !filePath.startsWith(uiRoot + sep)) return undefined;
    if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
  }
  return undefined;
}

function serveStatic(pathname: string, res: ServerResponse, uiRoot: string, headOnly: boolean): void {
  if (pathname.includes("..") || decodeURIComponent(pathname).includes("..") || pathname.includes("\0")) {
    text(res, 403, "forbidden\n");
    return;
  }
  const filePath = resolveStatic(pathname, uiRoot);
  if (!filePath) {
    if (pathname === "/") {
      text(res, 503, `UI not built: ${join(uiRoot, "index.html")} is missing. Run "pnpm --filter @postrun/ui build" (or "pnpm serve" from the repo root, which builds first).\n`);
      return;
    }
    text(res, 404, "not found\n");
    return;
  }
  const body = readFileSync(filePath);
  res.writeHead(200, {
    ...BASE_HEADERS,
    "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
    "content-length": body.byteLength,
  });
  res.end(headOnly ? undefined : body);
}

/** Read the session list's filters from the query string. Throws with a message for the client on a bad value. */
export function sessionQuery(p: URLSearchParams): SessionQuery {
  const q: SessionQuery = {};
  const str = (k: string) => {
    const v = p.get(k);
    return v === null || v === "" ? undefined : v;
  };
  const int = (k: string, min: number, max: number) => {
    const v = str(k);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${k} must be a whole number from ${min} to ${max}`);
    return n;
  };
  const time = (k: string) => {
    const v = str(k);
    if (v === undefined) return undefined;
    const t = Date.parse(v);
    if (Number.isNaN(t)) throw new Error(`${k} must be a date or time, such as 2026-10-06 or 2026-10-06T09:00:00Z`);
    return new Date(t).toISOString();
  };
  const agent = str("agent");
  if (agent) q.agent = agent;
  const text = str("q");
  if (text) q.q = text.slice(0, 200);
  const from = time("from");
  if (from) q.from = from;
  const to = time("to");
  if (to) q.to = to;
  const minSteps = int("min_steps", 0, 1_000_000);
  if (minSteps !== undefined) q.minSteps = minSteps;
  if (str("failed") === "1") q.failedOnly = true;
  if (str("empty") === "0") q.includeEmpty = false;
  const limit = int("limit", 1, MAX_PAGE);
  if (limit !== undefined) q.limit = limit;
  const cursor = str("cursor");
  if (cursor) q.cursor = cursor;
  const workspace = str("workspace");
  if (workspace) q.workspace = workspace;
  const verdict = str("verdict");
  if (verdict !== undefined) {
    if (verdict !== "none" && verdict !== "approved" && verdict !== "needs_attention") throw new Error('verdict must be "none", "approved" or "needs_attention"');
    q.verdict = verdict;
  }
  if (str("flagged") === "1") q.flagged = true;
  if (str("in_steps") === "0") q.inSteps = false;
  return q;
}

const JSON_BODY_LIMIT = 64 * 1024;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | "too_large" | "bad"> {
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return "bad";
  if (Number(req.headers["content-length"] ?? 0) > JSON_BODY_LIMIT) return "too_large";
  const body = await readBody(req, JSON_BODY_LIMIT);
  if (body === "too_large") return "too_large";
  try {
    const v = JSON.parse(body.length ? body.toString("utf8") : "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : "bad";
  } catch {
    return "bad";
  }
}

const noControl = (res: ServerResponse) =>
  json(res, 501, { error: "not available here: start Postrun with postrun start to change settings and see its status" } satisfies ApiError);

/** PUT and POST routes of the review app. Returns false when the path is not one of them. */
async function handleAppWrite(req: IncomingMessage, res: ServerResponse, url: URL, method: string, ctx: Ctx): Promise<boolean> {
  const verdict = /^\/api\/sessions\/([^/]+)\/verdict$/.exec(url.pathname);
  const share = /^\/api\/sessions\/([^/]+)\/share$/.exec(url.pathname);
  const routes = ["/api/settings", "/api/recording", "/api/setup", "/api/data/delete", "/api/usage", "/api/feedback", "/api/account/connect", "/api/account/disconnect"];
  if (!verdict && !share && !routes.includes(url.pathname)) return false;
  const want = verdict || url.pathname === "/api/settings" ? "PUT" : "POST";
  if (method !== want) {
    text(res, 405, "method not allowed\n", { allow: want });
    return true;
  }
  if (!sameOrigin(req)) {
    json(res, 403, { error: "cross-site request refused" } satisfies ApiError);
    return true;
  }
  const body = await readJson(req);
  if (body === "too_large") {
    // Answer, then drop the connection: the rest of an oversized body is never read.
    res.once("finish", () => req.destroy());
    res.writeHead(413, { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", connection: "close" });
    res.end(JSON.stringify({ error: "body too large" } satisfies ApiError));
    return true;
  }
  if (body === "bad") {
    json(res, 415, { error: "send a JSON object with content-type application/json" } satisfies ApiError);
    return true;
  }

  if (url.pathname === "/api/usage") {
    // Only the uses the page alone can see; the rest are counted by the server as they happen.
    const event = body["event"];
    if (!isUsageEvent(event) || !CLIENT_USAGE_EVENTS.includes(event)) {
      json(res, 400, { error: `event must be one of ${CLIENT_USAGE_EVENTS.join(", ")}` } satisfies ApiError);
      return true;
    }
    count(ctx, event);
    res.writeHead(204, BASE_HEADERS).end();
    return true;
  }

  if (verdict) {
    const id = decodeURIComponent(verdict[1] as string);
    const state = body["state"];
    if (state !== null && state !== "approved" && state !== "needs_attention") {
      json(res, 400, { error: 'state must be "approved", "needs_attention" or null' } satisfies ApiError);
      return true;
    }
    const note = typeof body["note"] === "string" ? body["note"] : undefined;
    if (!ctx.store.setVerdict(id, state, note)) {
      json(res, 404, { error: `session ${id} not found` } satisfies ApiError);
      return true;
    }
    ctx.live.nudge();
    if (state !== null) count(ctx, "review_marked");
    const v = ctx.store.getSessionShell(id)?.summary.verdict;
    json(res, 200, { id, verdict: v ? { state: v.state, ...(v.note ? { note: v.note } : {}) } : null } satisfies VerdictResponse);
    return true;
  }

  const control = ctx.control;
  if (!control) {
    noControl(res);
    return true;
  }
  if (share) {
    await handleShare(res, decodeURIComponent(share[1] as string), body, ctx);
    return true;
  }
  if (url.pathname === "/api/feedback") {
    await handleFeedback(res, body, ctx);
    return true;
  }
  if (url.pathname === "/api/account/connect" || url.pathname === "/api/account/disconnect") {
    const connect = url.pathname.endsWith("/connect");
    if (!(connect ? control.connect : control.disconnect)) {
      json(res, 501, { error: "accounts aren't available in this build" } satisfies ApiError);
      return true;
    }
    try {
      json(res, 200, connect ? await control.connect!() : await control.disconnect!());
    } catch (err) {
      json(res, 502, { error: (err as Error).message } satisfies ApiError);
    }
    return true;
  }
  try {
    if (url.pathname === "/api/settings") {
      const patch: Partial<AppSettings> = {};
      if (typeof body["autostart"] === "boolean") patch.autostart = body["autostart"];
      if (typeof body["notify_failures"] === "boolean") patch.notify_failures = body["notify_failures"];
      if (typeof body["update_check"] === "boolean") patch.update_check = body["update_check"];
      if (body["raw_log_hours"] !== undefined) {
        const h = body["raw_log_hours"];
        if (typeof h !== "number" || !Number.isInteger(h) || h < 0 || h > 24 * 365) {
          json(res, 400, { error: "raw_log_hours must be a whole number of hours, 0 to keep them" } satisfies ApiError);
          return true;
        }
        patch.raw_log_hours = h;
      }
      json(res, 200, await control.updateSettings(patch));
    } else if (url.pathname === "/api/recording") {
      if (typeof body["paused"] !== "boolean") {
        json(res, 400, { error: "paused must be true or false" } satisfies ApiError);
        return true;
      }
      json(res, 200, await control.setPaused(body["paused"]));
    } else if (url.pathname === "/api/setup") {
      json(res, 200, await control.runSetup());
    } else {
      if (body["confirm"] !== "delete everything") {
        json(res, 400, { error: 'send { "confirm": "delete everything" } to delete every recorded session' } satisfies ApiError);
        return true;
      }
      const r = await control.deleteAll();
      ctx.live.nudge();
      json(res, 200, r satisfies DeleteAllResponse);
    }
  } catch (err) {
    json(res, 500, { error: (err as Error).message } satisfies ApiError);
  }
  return true;
}

/**
 * Make a share link: the same redacted report as the export, uploaded by the background
 * process with this computer's sign-in (postrun login). The page never sees the token.
 */
async function handleShare(res: ServerResponse, id: string, body: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const control = ctx.control;
  if (!control?.share) {
    json(res, 501, { error: "share links aren't available in this build" } satisfies ApiError);
    return;
  }
  const days = body["expires_days"] ?? 30;
  if (typeof days !== "number" || ![1, 7, 30, 90].includes(days)) {
    json(res, 400, { error: "expires_days must be 1, 7, 30 or 90" } satisfies ApiError);
    return;
  }
  const session = ctx.store.getSession(id);
  if (!session) {
    json(res, 404, { error: `session ${id} not found` } satisfies ApiError);
    return;
  }
  const r = exportSession(session);
  try {
    const link = await control.share(r.html, days);
    count(ctx, "report_shared");
    json(res, 200, { ...link, masked: r.redaction.findings.length, home_paths: r.redaction.home_paths } satisfies ShareResponse);
  } catch (err) {
    const code = (err as { code?: string }).code;
    // 409, not 401: a 401 here would read as "this browser lost its key" and lock the review app.
    json(res, code === "not_signed_in" ? 409 : 502, { error: (err as Error).message, ...(code ? { code } : {}) } satisfies ApiError);
  }
}

/**
 * Feedback the person chose to send. The usage summary goes only when they ticked the box,
 * and it is the same counts-only text Settings and postrun stats show.
 */
async function handleFeedback(res: ServerResponse, body: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const control = ctx.control;
  if (!control?.feedback) {
    json(res, 501, { error: "feedback isn't available in this build" } satisfies ApiError);
    return;
  }
  const rating = body["rating"];
  if (rating !== undefined && rating !== null && !(typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
    json(res, 400, { error: "rating must be a whole number from 1 to 5" } satisfies ApiError);
    return;
  }
  const message = typeof body["message"] === "string" ? body["message"].trim().slice(0, 4000) : "";
  const email = typeof body["email"] === "string" ? body["email"].trim().slice(0, 254) : "";
  if (typeof rating !== "number" && !message) {
    json(res, 400, { error: "add a rating or a few words" } satisfies ApiError);
    return;
  }
  const version = String(ctx.health["version"] ?? "dev");
  const platform = `${process.platform} ${process.arch}`;
  const payload: FeedbackPayload = { source: "review-app", version, platform };
  if (typeof rating === "number") payload.rating = rating;
  if (message) payload.message = message;
  if (email) payload.email = email;
  if (body["include_usage"] === true) payload.usage = formatUsage(ctx.store.usage({ version, platform }));
  try {
    await control.feedback(payload);
    res.writeHead(204, BASE_HEADERS).end();
  } catch (err) {
    json(res, 502, { error: (err as Error).message } satisfies ApiError);
  }
}

/** GET routes of the review app beyond sessions. Returns false when the path is not one of them. */
async function handleAppRead(req: IncomingMessage, res: ServerResponse, url: URL, method: string, ctx: Ctx): Promise<boolean> {
  const { store } = ctx;
  switch (url.pathname) {
    case "/api/dashboard": {
      const days = Number(url.searchParams.get("days") ?? "7");
      if (![1, 7, 30, 90].includes(days)) {
        json(res, 400, { error: "days must be 1, 7, 30 or 90" } satisfies ApiError);
        return true;
      }
      json(res, 200, store.dashboard(days));
      return true;
    }
    case "/api/projects":
      json(res, 200, { projects: store.projects() } satisfies ProjectsResponse);
      return true;
    case "/api/projects/files": {
      const root = url.searchParams.get("root") ?? "";
      json(res, 200, { root, files: store.projectFiles(root) } satisfies ProjectFilesResponse);
      return true;
    }
    case "/api/usage": {
      const summary = store.usage({ version: String(ctx.health["version"] ?? "dev"), platform: `${process.platform} ${process.arch}` });
      json(res, 200, { ...summary, text: formatUsage(summary) } satisfies UsageResponse);
      return true;
    }
    case "/api/export": {
      const ids = [...new Set((url.searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean))].slice(0, 100);
      if (ids.length === 0) {
        json(res, 400, { error: "ids must list one or more session ids, separated by commas" } satisfies ApiError);
        return true;
      }
      const entries = [];
      const names = new Set<string>();
      for (const id of ids) {
        const session = store.getSession(id);
        if (!session) continue;
        const r = exportSession(session);
        // Two sessions can share agent, day and id prefix: number the later ones so none is overwritten.
        let name = r.filename;
        for (let n = 2; names.has(name); n++) name = r.filename.replace(/\.html$/, `-${n}.html`);
        names.add(name);
        entries.push({ name, data: Buffer.from(r.html, "utf8") });
      }
      if (entries.length === 0) {
        json(res, 404, { error: "none of those sessions were found" } satisfies ApiError);
        return true;
      }
      const body = zip(entries);
      if (method === "GET") count(ctx, "reports_zipped");
      res.writeHead(200, {
        ...BASE_HEADERS,
        "content-type": "application/zip",
        "content-length": body.byteLength,
        "content-disposition": `attachment; filename="postrun-${entries.length}-sessions-${new Date().toISOString().slice(0, 10)}.zip"`,
      });
      res.end(method === "HEAD" ? undefined : body);
      return true;
    }
    case "/api/account": {
      const control = ctx.control;
      if (!control?.account) {
        json(res, 200, { signed_in: false, server: "https://app.postrun.app" } satisfies AccountResponse);
        return true;
      }
      json(res, 200, await control.account());
      return true;
    }
    case "/api/status":
    case "/api/doctor":
    case "/api/backup": {
      const control = ctx.control;
      if (!control) {
        noControl(res);
        return true;
      }
      if (url.pathname === "/api/status") json(res, 200, await control.status());
      else if (url.pathname === "/api/doctor") json(res, 200, { checks: await control.doctor() } satisfies DoctorResponse);
      else {
        // A consistent copy of the store, streamed, then removed. It is the unredacted store: same origin only.
        if (!sameOrigin(req)) {
          json(res, 403, { error: "cross-site request refused" } satisfies ApiError);
          return true;
        }
        // The copy is a full, unredacted store: it is removed however the download ends (finished,
        // cancelled, or failed), and a failure while making it leaves nothing behind either.
        const dir = mkdtempSync(join(tmpdir(), "postrun-backup-"));
        const cleanUp = () => rmSync(dir, { recursive: true, force: true });
        const file = join(dir, "postrun-backup.db");
        try {
          store.backupTo(file);
        } catch (err) {
          cleanUp();
          throw err;
        }
        res.writeHead(200, {
          ...BASE_HEADERS,
          "content-type": "application/vnd.sqlite3",
          "content-length": statSync(file).size,
          "content-disposition": `attachment; filename="postrun-backup-${new Date().toISOString().slice(0, 10)}.db"`,
        });
        if (method === "HEAD") {
          res.end();
          cleanUp();
        } else {
          count(ctx, "backup_saved");
          pipeline(createReadStream(file), res, cleanUp);
        }
      }
      return true;
    }
    default:
      return false;
  }
}
