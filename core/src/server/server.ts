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
 *   GET  /api/sessions/:id           one full session plus report projections
 *   POST /api/ingest                 push a v1.2 batch (bearer token; see ingest.ts, token.ts)
 *   GET  /                           the built UI (ui/out)
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { sessionReport } from "../report/index.js";
import { PostrunStore } from "../store/index.js";
import { isLoopbackHost } from "../util/host.js";
import type { ApiError, IngestErrorResponse, IngestResponse, SessionDetailResponse, SessionListResponse } from "./api.js";
import { checkIngest, MAX_INGEST_BYTES } from "./ingest.js";
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
}

export interface PostrunServer {
  server: Server;
  store: PostrunStore;
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

  const server = createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res, store, uiRoot, ingestToken))
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
      server.close((err) => {
        if (ownsStore) store.close();
        if (err) reject(err);
        else resolvePromise();
      });
    });

  return { server, store, start, stop };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function text(res: ServerResponse, status: number, body: string, extra: Record<string, string | number> = {}): void {
  res.writeHead(status, { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8", ...extra });
  res.end(body);
}

async function handle(req: IncomingMessage, res: ServerResponse, store: PostrunStore, uiRoot: string, ingestToken: string): Promise<void> {
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

  // The one write route. Everything else is read-only.
  if (url.pathname === "/api/ingest") {
    if (method !== "POST") {
      text(res, 405, "method not allowed\n", { allow: "POST" });
      return;
    }
    await handleIngest(req, res, store, ingestToken);
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    text(res, 405, "method not allowed\n", { allow: "GET, HEAD" });
    return;
  }

  if (url.pathname === "/api/sessions") {
    const agent = url.searchParams.get("agent");
    const sessions = store.listSessions(agent ? { agent } : {});
    const agents = [...new Set(store.listSessions().map((s) => s.agent.kind))].sort();
    const body: SessionListResponse = { sessions, agents };
    json(res, 200, body);
    return;
  }

  const m = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
  if (m) {
    const id = decodeURIComponent(m[1] as string);
    const session = store.getSession(id);
    if (!session) {
      const body: ApiError = { error: `session ${id} not found` };
      json(res, 404, body);
      return;
    }
    const body: SessionDetailResponse = { ...session, report: sessionReport(session.steps) };
    json(res, 200, body);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    json(res, 404, { error: "not found" });
    return;
  }

  serveStatic(url.pathname, res, uiRoot, method === "HEAD");
}

async function handleIngest(req: IncomingMessage, res: ServerResponse, store: PostrunStore, token: string): Promise<void> {
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
  const result: IngestResponse = store.appendBatch(checked.batch);
  json(res, result.created ? 201 : 200, result);
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
