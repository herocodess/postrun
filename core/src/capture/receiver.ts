/**
 * Minimal OTLP http/json receiver for Claude Code telemetry.
 *
 * Listens on 127.0.0.1 only (default port 4318). Appends each export request
 * as one NDJSON line per signal, {received_at, payload}, exactly the format
 * the Claude Code adapter reads. Append-only; restarts never clobber.
 */

import { createServer, type Server } from "node:http";
import { createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { ensurePrivateDir, ensurePrivateFile, PRIVATE_FILE_MODE } from "../util/files.js";
import { isLoopbackHost } from "../util/host.js";

export const OTLP_HOST = "127.0.0.1";
export const DEFAULT_OTLP_PORT = 4318;
/** Largest export request accepted, before and after gzip. Claude Code batches are a few hundred KB at most. */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

const SIGNALS: Record<string, string> = {
  "/v1/logs": "otlp-logs.ndjson",
  "/v1/metrics": "otlp-metrics.ndjson",
  "/v1/traces": "otlp-traces.ndjson",
};

export interface ReceiverOptions {
  captureDir: string;
  port?: number;
  log?: (line: string) => void;
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
  for (const name of Object.values(SIGNALS)) ensurePrivateFile(join(opts.captureDir, name));
  const port = opts.port ?? DEFAULT_OTLP_PORT;
  const log = opts.log ?? (() => undefined);
  const streams = new Map<string, WriteStream>();
  const streamFor = (path: string): WriteStream => {
    let s = streams.get(path);
    if (!s) {
      s = createWriteStream(join(opts.captureDir, SIGNALS[path] as string), { flags: "a", mode: PRIVATE_FILE_MODE });
      streams.set(path, s);
    }
    return s;
  };
  const counts: Record<string, number> = { "/v1/logs": 0, "/v1/metrics": 0, "/v1/traces": 0 };

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
        if (!ct.includes("application/json")) {
          log(`${path}: got ${ct || "no content-type"}, expected application/json. Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json before launching claude.`);
          res.writeHead(415).end();
          return;
        }
        const payload: unknown = JSON.parse(body.toString("utf8"));
        streamFor(path).write(JSON.stringify({ received_at: new Date().toISOString(), payload }) + "\n");
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
      server.close((err) => {
        for (const s of streams.values()) s.end();
        if (err) reject(err);
        else resolve();
      });
    });

  return { server, counts, start, stop };
}
