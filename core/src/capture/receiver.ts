/**
 * Minimal OTLP http/json receiver for Claude Code telemetry.
 *
 * Listens on 127.0.0.1 only (default port 4318). Appends each export request
 * as one NDJSON line per signal, {received_at, payload}, exactly the format
 * the Claude Code adapter reads. Append-only; restarts never clobber.
 */

import { createServer, type Server } from "node:http";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export const OTLP_HOST = "127.0.0.1";
export const DEFAULT_OTLP_PORT = 4318;

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
  mkdirSync(opts.captureDir, { recursive: true });
  const port = opts.port ?? DEFAULT_OTLP_PORT;
  const log = opts.log ?? (() => undefined);
  const streams = new Map<string, WriteStream>();
  const streamFor = (path: string): WriteStream => {
    let s = streams.get(path);
    if (!s) {
      s = createWriteStream(join(opts.captureDir, SIGNALS[path] as string), { flags: "a" });
      streams.set(path, s);
    }
    return s;
  };
  const counts: Record<string, number> = { "/v1/logs": 0, "/v1/metrics": 0, "/v1/traces": 0 };

  const server = createServer((req, res) => {
    const path = req.url ?? "";
    if (req.method !== "POST" || !(path in SIGNALS)) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        let body = Buffer.concat(chunks);
        if (req.headers["content-encoding"] === "gzip") body = gunzipSync(body);
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
