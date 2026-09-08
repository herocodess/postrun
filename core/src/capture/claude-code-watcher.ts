/**
 * Claude Code live capture: tail hooks.ndjson and ingest sessions into the store.
 *
 * Trigger policy:
 * - Stop (end of an assistant turn): ingest the session, debounced. The session
 *   lands in the store while still open (ended_at unset), and every later
 *   ingest is an idempotent upsert, so partial sessions are safe and visible.
 * - SessionEnd: ingest again after a short delay so the last OTel exports
 *   (2s interval by default) have been received.
 * - Startup: scan the whole file, ingest every session that already has a
 *   SessionEnd (idempotent; sessions without OTel data are reported, not
 *   ingested, because the adapter needs otlp-logs for ordering and cost).
 *
 * The adapter needs both channels, so a session whose claude was launched
 * without the OTel env is skipped with a warning naming the session.
 *
 * Read only on the capture files: this tails, it never writes.
 */

import { existsSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { join } from "node:path";
import { claudeCodeRecord } from "../store/ingest.js";
import type { PostrunStore } from "../store/store.js";
import type { IngestResult } from "../store/types.js";

export interface ClaudeCodeWatcherOptions {
  captureDir: string;
  store: PostrunStore;
  /** Poll interval for new bytes in hooks.ndjson (ms). */
  pollMs?: number;
  /** Delay between a trigger and the ingest (ms), so OTel exports can flush. */
  debounceMs?: number;
  log?: (line: string) => void;
  onIngest?: (result: IngestResult, trigger: string) => void;
}

export interface ClaudeCodeWatcher {
  start(): void;
  stop(): void;
  /** Ingest one session now (on demand). Returns undefined when the adapter cannot read it. */
  ingest(sessionId: string, trigger?: string): IngestResult | undefined;
  /** Sessions seen in hooks.ndjson, with whether a SessionEnd was seen. */
  sessions(): Map<string, { ended: boolean; last_event: string }>;
}

interface HookLine {
  payload?: { session_id?: string; hook_event_name?: string };
}

export function createClaudeCodeWatcher(opts: ClaudeCodeWatcherOptions): ClaudeCodeWatcher {
  const file = join(opts.captureDir, "hooks.ndjson");
  const pollMs = opts.pollMs ?? 1000;
  const debounceMs = opts.debounceMs ?? 4000;
  const log = opts.log ?? (() => undefined);
  const seen = new Map<string, { ended: boolean; last_event: string }>();
  const timers = new Map<string, NodeJS.Timeout>();
  const skipped = new Set<string>(); // sessions without OTel data, reported once
  let offset = 0;
  let remainder = "";
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  const ingest = (sessionId: string, trigger = "on-demand"): IngestResult | undefined => {
    try {
      const record = claudeCodeRecord(opts.captureDir, sessionId);
      const result = opts.store.ingest(record);
      skipped.delete(sessionId);
      log(`claude-code ${result.created ? "ingested" : "updated"} ${sessionId} (${result.steps} steps) on ${trigger}`);
      opts.onIngest?.(result, trigger);
      return result;
    } catch (err) {
      const msg = (err as Error).message;
      if (/not found in otlp-logs|no session found/.test(msg)) {
        if (!skipped.has(sessionId)) {
          skipped.add(sessionId);
          log(`claude-code ${sessionId}: hooks only, no OTel data (launch claude with the capture env from \`pnpm capture:cc:setup\`); skipped`);
        }
      } else {
        log(`claude-code ${sessionId}: ingest failed on ${trigger}: ${msg}`);
      }
      return undefined;
    }
  };

  const schedule = (sessionId: string, trigger: string, delay: number) => {
    const existing = timers.get(sessionId);
    if (existing) clearTimeout(existing);
    timers.set(
      sessionId,
      setTimeout(() => {
        timers.delete(sessionId);
        ingest(sessionId, trigger);
      }, delay),
    );
  };

  const handleLine = (line: string, live: boolean) => {
    let parsed: HookLine;
    try {
      parsed = JSON.parse(line) as HookLine;
    } catch {
      return; // spliced concurrent append; the adapter skips these too
    }
    const sid = parsed.payload?.session_id;
    const ev = parsed.payload?.hook_event_name;
    if (!sid || !ev) return;
    const s = seen.get(sid) ?? { ended: false, last_event: ev };
    s.last_event = ev;
    if (ev === "SessionEnd") s.ended = true;
    seen.set(sid, s);
    if (!live) return;
    if (ev === "Stop") schedule(sid, "Stop", debounceMs);
    else if (ev === "SessionEnd") schedule(sid, "SessionEnd", debounceMs);
  };

  const readNew = (live: boolean) => {
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (size < offset) {
      // truncated or rotated: start over
      offset = 0;
      remainder = "";
    }
    if (size === offset) return;
    const fd = openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      const text = remainder + buf.toString("utf8");
      const lines = text.split("\n");
      remainder = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) handleLine(l, live);
    } finally {
      closeSync(fd);
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      readNew(false); // learn existing sessions without triggering per-line ingests
      const ended = [...seen].filter(([, s]) => s.ended).map(([id]) => id);
      log(`claude-code: tailing ${file} (${seen.size} session(s) seen, ${ended.length} ended)`);
      for (const id of ended) ingest(id, "startup");
      timer = setInterval(() => readNew(true), pollMs);
    },
    stop() {
      running = false;
      if (timer) clearInterval(timer);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
    ingest,
    sessions: () => new Map(seen),
  };
}
