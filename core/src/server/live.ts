/**
 * Live session feed for GET /api/events (server-sent events).
 *
 * Writes reach the store from three places: POST /api/ingest in this
 * process, and the capture watchers and `pnpm ingest`, which are separate
 * processes with their own connection to the same SQLite file. An in-process
 * event bus would miss the last two, so the feed watches the store itself:
 * one cheap query on sessions.updated_at every pollMs, only while at least one
 * client is connected. In-process writes call nudge() to skip the wait.
 *
 * Events say which session changed, not what changed. Clients refetch
 * GET /api/sessions/:id. That stays correct when a writer rewrites earlier
 * steps (Claude Code's hook record lands after its OTLP event and upgrades a
 * reference_only step to inline), which a seq-based delta would miss. A poll
 * tick sends at most one event per session, so a burst of writes coalesces.
 *
 * Wire format:
 *   retry: 2000
 *   event: ready    data: {}                                   on connect
 *   event: change   data: {"session_id":"...","updated_at":"..."}
 *   : ping                                                     every 15 s
 * Clients should refetch on every `ready`: it also marks a reconnect, and
 * changes made while disconnected are not replayed.
 */

import type { ServerResponse } from "node:http";
import type { PostrunStore } from "../store/index.js";

export interface LiveChange {
  session_id: string;
  updated_at: string;
}

export interface LiveFeedOptions {
  /** How often to look for changes while clients are connected. Default 500 ms. */
  pollMs?: number;
  /** Comment line interval that keeps idle connections and proxies open. Default 15 s. */
  heartbeatMs?: number;
  /** Most simultaneous streams. Further clients get 503. Default 32. */
  maxClients?: number;
}

interface Client {
  res: ServerResponse;
  sessionId?: string;
}

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

export class LiveFeed {
  private readonly clients = new Set<Client>();
  private readonly pollMs: number;
  private readonly heartbeatMs: number;
  readonly maxClients: number;
  private poller: NodeJS.Timeout | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  /** Timestamps are compared with >=, so the last one seen per session dedupes rows read twice at the cursor. */
  private cursor = "";
  private readonly seen = new Map<string, string>();

  constructor(
    private readonly store: Pick<PostrunStore, "changedSince" | "lastUpdatedAt">,
    opts: LiveFeedOptions = {},
  ) {
    this.pollMs = opts.pollMs ?? 500;
    this.heartbeatMs = opts.heartbeatMs ?? 15_000;
    this.maxClients = opts.maxClients ?? 32;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Attach an open response as an event stream. Returns false when full; the caller answers 503. */
  attach(res: ServerResponse, sessionId?: string): boolean {
    if (this.clients.size >= this.maxClients) return false;
    if (this.clients.size === 0) this.startPolling();
    const client: Client = sessionId !== undefined ? { res, sessionId } : { res };
    this.clients.add(client);
    res.on("close", () => {
      this.clients.delete(client);
      if (this.clients.size === 0) this.stopPolling();
    });
    res.write("retry: 2000\n\nevent: ready\ndata: {}\n\n");
    return true;
  }

  /** Look for changes now instead of on the next tick. For writes made in this process. */
  nudge(): void {
    if (this.clients.size > 0) this.poll();
  }

  /** End every stream and stop timers. Called on server stop. */
  close(): void {
    for (const c of this.clients) c.res.end();
    this.clients.clear();
    this.stopPolling();
  }

  private startPolling(): void {
    // Only changes after the first client connects are news; earlier ones are in its initial fetch.
    this.cursor = this.store.lastUpdatedAt() ?? "";
    this.seen.clear();
    for (const row of this.cursor ? this.store.changedSince(this.cursor) : []) this.seen.set(row.id, row.updated_at);
    this.poller = setInterval(() => this.poll(), this.pollMs);
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) c.res.write(": ping\n\n");
    }, this.heartbeatMs);
    this.poller.unref();
    this.heartbeat.unref();
  }

  private stopPolling(): void {
    clearInterval(this.poller);
    clearInterval(this.heartbeat);
    this.poller = undefined;
    this.heartbeat = undefined;
  }

  private poll(): void {
    let rows: Array<{ id: string; updated_at: string }>;
    try {
      rows = this.store.changedSince(this.cursor);
    } catch (err) {
      // A busy or briefly locked database is retried on the next tick.
      process.stderr.write(`postrun live feed: ${(err as Error).message}\n`);
      return;
    }
    for (const row of rows) {
      if (this.seen.get(row.id) === row.updated_at) continue;
      this.seen.set(row.id, row.updated_at);
      if (row.updated_at > this.cursor) this.cursor = row.updated_at;
      this.broadcast({ session_id: row.id, updated_at: row.updated_at });
    }
  }

  private broadcast(change: LiveChange): void {
    const frame = `event: change\ndata: ${JSON.stringify(change)}\n\n`;
    for (const c of this.clients) {
      if (c.sessionId === undefined || c.sessionId === change.session_id) c.res.write(frame);
    }
  }
}
