/**
 * Minimal OTLP http/json receiver for Claude Code telemetry.
 *
 * Listens on 127.0.0.1 only (default port 4318). Log exports are split by
 * session: each session's records are appended as one NDJSON line,
 * {received_at, payload}, to sessions/<id>/otlp-logs.ndjson, the format the
 * Claude Code adapter reads. Append-only; restarts never clobber.
 *
 * Metrics and traces are accepted and dropped: Postrun never reads them, and
 * setup no longer asks for them. A Claude Code started before that change may
 * still send them until it restarts.
 */

import { createServer, type Server } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { ensurePrivateDir, PRIVATE_FILE_MODE } from "../util/files.js";
import { isLoopbackHost } from "../util/host.js";
import { isSafeId, SESSION_OTLP_FILE, sessionDir } from "./layout.js";

export const OTLP_HOST = "127.0.0.1";
export const DEFAULT_OTLP_PORT = 4318;
/** Largest export request accepted, before and after gzip. Claude Code batches are a few hundred KB at most. */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

const SIGNALS: Record<string, "keep" | "drop"> = {
  "/v1/logs": "keep",
  "/v1/metrics": "drop",
  "/v1/traces": "drop",
};

interface OtlpAttr {
  key: string;
  value?: { stringValue?: string };
}
interface LogsPayload {
  resourceLogs?: Array<{ resource?: unknown; scopeLogs?: Array<{ scope?: unknown; logRecords?: Array<{ attributes?: OtlpAttr[] }> }> }>;
}

/**
 * Split one OTLP logs export into one payload per session, keeping each
 * record's resource and scope. Records without a usable session.id are dropped:
 * the adapter could never place them.
 */
export function splitLogsBySession(payload: unknown): Map<string, LogsPayload> {
  const out = new Map<string, LogsPayload>();
  for (const rl of (payload as LogsPayload | null)?.resourceLogs ?? []) {
    for (const sl of rl.scopeLogs ?? []) {
      for (const rec of sl.logRecords ?? []) {
        const id = rec.attributes?.find((a) => a.key === "session.id")?.value?.stringValue;
        if (!isSafeId(id)) continue;
        const p = out.get(id) ?? { resourceLogs: [] };
        out.set(id, p);
        // Group under the same resource/scope objects so a session's slice stays one compact payload.
        let r = p.resourceLogs!.find((x) => x.resource === rl.resource);
        if (!r) p.resourceLogs!.push((r = { resource: rl.resource, scopeLogs: [] }));
        let s = r.scopeLogs!.find((x) => x.scope === sl.scope);
        if (!s) r.scopeLogs!.push((s = { scope: sl.scope, logRecords: [] }));
        s.logRecords!.push(rec);
      }
    }
  }
  return out;
}

export interface ReceiverOptions {
  captureDir: string;
  port?: number;
  log?: (line: string) => void;
  /** True while recording is paused: exports are acknowledged and dropped, never written. */
  paused?: () => boolean;
  /**
   * The telemetry key Claude Code sends as the x-postrun-key header (set in its settings by setup).
   * Exports without it are acknowledged and dropped: nothing but Claude Code can write telemetry,
   * and a session started before the key existed shows no errors, only no cost data.
   */
  key?: string;
}

/** One session's telemetry file stops growing here; a runaway or hostile sender cannot fill the disk. */
export const MAX_SESSION_OTLP_BYTES = 256 * 1024 * 1024;

function keyMatches(given: string | string[] | undefined, key: string): boolean {
  if (typeof given !== "string") return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(key).digest();
  return timingSafeEqual(a, b);
}

/** Only exactly application/json (with parameters such as charset), never a type that merely contains it. */
function isJson(ct: string | undefined): boolean {
  return (ct ?? "").split(";")[0]!.trim().toLowerCase() === "application/json";
}

export interface OtlpReceiver {
  server: Server;
  counts: Record<string, number>;
  start(): Promise<{ url: string; port: number }>;
  stop(): Promise<void>;
}

export class OtlpPortInUseError extends Error {
  constructor(public readonly port: number) {
    super(`OTLP receiver port ${port} is already in use on ${OTLP_HOST}. Set POSTRUN_OTLP_PORT to another port (and OTEL_EXPORTER_OTLP_ENDPOINT to match).`);
    this.name = "OtlpPortInUseError";
  }
}

export function createOtlpReceiver(opts: ReceiverOptions): OtlpReceiver {
  // Telemetry holds prompts and tool content: the directory and files are private to this user.
  ensurePrivateDir(opts.captureDir);
  const port = opts.port ?? DEFAULT_OTLP_PORT;
  const log = opts.log ?? (() => undefined);
  const counts: Record<string, number> = { "/v1/logs": 0, "/v1/metrics": 0, "/v1/traces": 0 };
  let lastRejectLog = 0;
  const capped = new Set<string>();

  const server = createServer((req, res) => {
    const path = req.url ?? "";
    if (!isLoopbackHost(req.headers.host)) {
      res.writeHead(421).end();
      return;
    }
    if (req.method !== "POST" || !Object.hasOwn(SIGNALS, path)) {
      res.writeHead(404).end();
      return;
    }
    // Claude Code's exporter is not a browser: it sends no Origin and no Sec-Fetch-Site. A page on
    // any site that tries to post here (no-cors) carries one of them and is refused.
    const site = req.headers["sec-fetch-site"];
    if (req.headers.origin !== undefined || (site !== undefined && site !== "none")) {
      res.writeHead(403).end();
      req.destroy();
      return;
    }
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > MAX_BODY_BYTES) {
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    let rejected = false;
    req.on("data", (c: Buffer) => {
      received += c.length;
      if (received > MAX_BODY_BYTES) {
        if (!rejected) {
          rejected = true;
          log(`${path}: export larger than ${MAX_BODY_BYTES} bytes rejected`);
          res.writeHead(413).end();
          req.destroy();
        }
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        let body = Buffer.concat(chunks);
        // maxOutputLength bounds decompression so a small gzip body cannot expand without limit.
        if (req.headers["content-encoding"] === "gzip") body = gunzipSync(body, { maxOutputLength: MAX_BODY_BYTES });
        const ct = req.headers["content-type"] ?? "";
        if (!isJson(ct)) {
          log(`${path}: got ${ct || "no content-type"}, expected application/json. Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json before launching claude.`);
          res.writeHead(415).end();
          return;
        }
        const payload: unknown = JSON.parse(body.toString("utf8"));
        const keyed = !opts.key || keyMatches(req.headers["x-postrun-key"], opts.key);
        if (!keyed) {
          counts["rejected"] = (counts["rejected"] ?? 0) + 1;
          const now = Date.now();
          if (now - lastRejectLog > 60_000) {
            lastRejectLog = now;
            log(`${path}: telemetry without Postrun's key dropped (a Claude Code session started before the last setup? restart it for cost data)`);
          }
        }
        if (SIGNALS[path] === "keep" && keyed && !opts.paused?.()) {
          const received_at = new Date().toISOString();
          // Synchronous appends: the line is on disk before Claude Code gets its 200, and a stop()
          // right after never loses an export. Exports are small and arrive every few seconds.
          for (const [sessionId, slice] of splitLogsBySession(payload)) {
            const dir = sessionDir(opts.captureDir, sessionId);
            ensurePrivateDir(dir);
            const file = join(dir, SESSION_OTLP_FILE);
            if (existsSync(file) && statSync(file).size > MAX_SESSION_OTLP_BYTES) {
              if (!capped.has(sessionId)) {
                capped.add(sessionId);
                log(`${path}: telemetry for session ${sessionId} is over ${MAX_SESSION_OTLP_BYTES / 1024 / 1024} MB; further exports are dropped`);
              }
              continue;
            }
            appendFileSync(file, JSON.stringify({ received_at, payload: slice }) + "\n", { mode: PRIVATE_FILE_MODE });
          }
        }
        counts[path] = (counts[path] ?? 0) + 1;
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      } catch (err) {
        log(`${path}: bad export request: ${(err as Error).message}`);
        res.writeHead(400).end();
      }
    });
  });

  const start = () =>
    new Promise<{ url: string; port: number }>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        reject(err.code === "EADDRINUSE" ? new OtlpPortInUseError(port) : err);
      };
      const onListening = () => {
        server.off("error", onError);
        const addr = server.address();
        const bound = addr && typeof addr !== "string" ? addr.port : port;
        resolve({ url: `http://${OTLP_HOST}:${bound}`, port: bound });
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, OTLP_HOST); // never 0.0.0.0
    });

  const stop = () =>
    new Promise<void>((resolve, reject) => {
      // Appends are synchronous, so everything accepted is already on disk.
      server.close((err) => (err ? reject(err) : resolve()));
    });

  return { server, counts, start, stop };
}
