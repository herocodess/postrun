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
 *   POST /api/ingest                 push a v1.2 batch (bearer token; see ingest.ts, token.ts)
 *   GET  /api/events[?session=id]    live change stream, server-sent events (see live.ts)
 *   GET  /                           the built UI (apps/ui/out)
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { exportSession } from "../export/index.js";
import { sessionReport } from "../report/index.js";
import { isSafeId, sessionDir } from "../capture/layout.js";
import { BadCursorError, DeletedSessionError, MAX_PAGE, PostrunStore, type SessionQuery } from "../store/index.js";
import { isLoopbackHost } from "../util/host.js";
import type {
  ApiError,
  DeleteSessionResponse,
  ExportReviewResponse,
  IngestErrorResponse,
  IngestResponse,
  SessionDeltaResponse,
  SessionDetailResponse,
  SessionListResponse,
  StepResponse,
} from "./api.js";
import { previewStep } from "./preview.js";
import { checkIngest, MAX_INGEST_BYTES } from "./ingest.js";
import { LiveFeed, SSE_HEADERS, type LiveFeedOptions } from "./live.js";
import { bearerMatches, loadOrCreateToken } from "./token.js";

/** Sent on every response. No CORS headers are ever set: only same-origin pages may read the API. */
const BASE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
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
  /** Live feed tuning (poll interval, heartbeat, client cap). Tests shorten these. */
  live?: LiveFeedOptions;
  /** Capture folder whose per-session raw files a delete also removes. Default POSTRUN_CAPTURE_DIR or ~/.postrun/captures. */
  captureDir?: string;
  /** Extra fields for GET /api/health, such as the version and pid of the background process. */
  health?: Record<string, unknown>;
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
      .then(() => handle(req, res, { store, uiRoot, ingestToken, live, captureDir, health: opts.health ?? {} }))
      .catch((err: unknown) => {
        // Never echo internal error text (paths, SQL) to the client.
        process.stderr.write(`postrun server: ${req.method ?? ""} ${req.url ?? ""}: ${(err as Error).message}\n`);
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

function text(res: ServerResponse, status: number, body: string, extra: Record<string, string | number> = {}): void {
  res.writeHead(status, { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8", ...extra });
  res.end(body);
}

interface Ctx {
  store: PostrunStore;
  uiRoot: string;
  ingestToken: string;
  live: LiveFeed;
  captureDir: string;
  health: Record<string, unknown>;
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

  if (method !== "GET" && method !== "HEAD") {
    text(res, 405, "method not allowed\n", { allow: del ? "GET, HEAD, DELETE" : "GET, HEAD" });
    return;
  }

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
    req.destroy();
    return;
  }

  let raw = await readBody(req, MAX_INGEST_BYTES);
  if (raw === "too_large") {
    fail(413, { error: `body larger than ${MAX_INGEST_BYTES} bytes` }, { connection: "close" });
    req.destroy();
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
  const candidates = extname(rel) ? [rel] : [`${rel}.html`, join(rel, "index.html")];
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
  return q;
}
