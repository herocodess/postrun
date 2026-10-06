/**
 * Claude Code live capture: route hook events into per-session folders and
 * ingest sessions into the store.
 *
 * Files (see layout.ts): the hook script appends every event to one inbox,
 * <captureDir>/hooks.ndjson. The OTLP receiver writes telemetry straight into
 * <captureDir>/sessions/<id>/otlp-logs.ndjson. This watcher:
 *
 * - Routes the inbox. Every poll it reads only the bytes added since the last
 *   poll, in small chunks, and appends each line to that session's
 *   sessions/<id>/hooks.ndjson. The read position is saved in
 *   .router-state.json, so a restart resumes exactly where it stopped. Once
 *   the inbox is fully routed and over `rotateBytes` it is renamed and drained,
 *   so it never grows: nothing is ever read whole, and no read depends on how
 *   much history exists.
 * - Ingests on Stop (end of an assistant turn) and SessionEnd, after a short
 *   wait so the last telemetry export arrives. Each ingest reads that session's
 *   folder only, and ingests are paced (pacer.ts) to about 1% of a core per busy
 *   session. A session appears while still open and is updated as it runs.
 * - Catches up on start: every session folder not already complete in the store
 *   is ingested. That recovers sessions that ran while capture was stopped.
 * - Cleans up: a session folder idle for `retainMs` (24 hours) is ingested one
 *   final time and deleted. The store keeps everything the app and exports use.
 *   POSTRUN_KEEP_CAPTURES=1 keeps the folders.
 * - Migrates the old layout once: a shared otlp-logs.ndjson is split into the
 *   session folders, streamed, and removed, as are otlp-metrics.ndjson and
 *   otlp-traces.ndjson, which were never read.
 *
 * A session with no telemetry is still ingested from its hooks (Claude Code
 * writes them itself); only cost and tokens are missing, logged once.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { forEachLine } from "../adapters/claude-code/ndjson.js";
import { claudeCodeRecord } from "../store/ingest.js";
import type { PostrunStore } from "../store/store.js";
import type { IngestResult } from "../store/types.js";
import { ensurePrivateDir, PRIVATE_FILE_MODE } from "../util/files.js";
import { INBOX_FILE, isSafeId, SESSION_HOOKS_FILE, SESSION_OTLP_FILE, sessionDir, sessionsDir } from "./layout.js";
import { createPacer } from "./pacer.js";
import { splitLogsBySession } from "./receiver.js";

export interface ClaudeCodeWatcherOptions {
  captureDir: string;
  store: PostrunStore;
  /** Poll interval for new bytes in the inbox (ms). */
  pollMs?: number;
  /** Delay between a trigger and the ingest (ms), so OTel exports can flush. */
  debounceMs?: number;
  /** Share of one core a busy session may use for re-ingests (default 0.01). */
  budget?: number;
  /** How long a session folder must be idle before it is deleted. Default 24 h; Infinity keeps folders. */
  retainMs?: number;
  /** Inbox size (bytes) at which it is rotated once fully routed. */
  rotateBytes?: number;
  log?: (line: string) => void;
  onIngest?: (result: IngestResult, trigger: string) => void;
}

export interface ClaudeCodeWatcher {
  start(): void;
  stop(): void;
  /** Ingest one session now (on demand). Returns undefined when the adapter cannot read it. */
  ingest(sessionId: string, trigger?: string): IngestResult | undefined;
  /** Sessions with a capture folder, with whether a SessionEnd was seen while routing. */
  sessions(): Map<string, { ended: boolean; last_event: string }>;
  /** Run the clean-up pass now (normally every 10 minutes). Returns the session ids whose folders were removed. */
  cleanUp(now?: number): string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STATE_FILE = ".router-state.json";
const ROTATING_SUFFIX = ".routing";

interface RouterState {
  offset: number;
  /** Inode of the inbox the offset belongs to: a replaced inbox is read from the start, whatever its size. */
  ino?: number;
  /** A rotated inbox still being drained, with how far it was read. */
  rotating?: { offset: number };
}

export function createClaudeCodeWatcher(opts: ClaudeCodeWatcherOptions): ClaudeCodeWatcher {
  const inbox = join(opts.captureDir, INBOX_FILE);
  const rotating = inbox + ROTATING_SUFFIX;
  const statePath = join(opts.captureDir, STATE_FILE);
  const pollMs = opts.pollMs ?? 1000;
  const debounceMs = opts.debounceMs ?? 4000;
  const keep = process.env["POSTRUN_KEEP_CAPTURES"] === "1";
  const retainMs = keep ? Infinity : (opts.retainMs ?? DAY_MS);
  const rotateBytes = opts.rotateBytes ?? 1024 * 1024;
  const log = opts.log ?? (() => undefined);
  const seen = new Map<string, { ended: boolean; last_event: string }>();
  const hooksOnlyReported = new Set<string>();
  let state: RouterState = { offset: 0 };
  let timer: NodeJS.Timeout | undefined;
  let cleanTimer: NodeJS.Timeout | undefined;
  let running = false;
  let drainPolls = 0;

  const ingest = (sessionId: string, trigger = "on-demand"): IngestResult | undefined => {
    try {
      const record = claudeCodeRecord(sessionDir(opts.captureDir, sessionId), sessionId);
      const result = opts.store.ingest(record);
      const hooksOnly = record.segments.every((s) => !s.source_files.includes(SESSION_OTLP_FILE));
      if (hooksOnly && !hooksOnlyReported.has(sessionId)) {
        hooksOnlyReported.add(sessionId);
        log(`claude-code ${sessionId}: recorded from hooks only (no OTel data: the receiver was not running, or this claude started before setup), so its cost and token counts are missing`);
      }
      log(`claude-code ${result.created ? "ingested" : "updated"} ${sessionId} (${result.steps} steps) on ${trigger}`);
      opts.onIngest?.(result, trigger);
      return result;
    } catch (err) {
      log(`claude-code ${sessionId}: ingest failed on ${trigger}: ${(err as Error).message}`);
      return undefined;
    }
  };

  const pacer = createPacer({ run: (id, why) => void ingest(id, why), minDelayMs: debounceMs, ...(opts.budget !== undefined ? { budget: opts.budget } : {}) });

  // ---- routing ----------------------------------------------------------------

  const saveState = () => {
    try {
      writeFileSync(statePath, JSON.stringify(state), { mode: PRIVATE_FILE_MODE });
    } catch (err) {
      log(`claude-code: could not save router state: ${(err as Error).message}`);
    }
  };

  /** Route complete lines of `file` from `from`; returns the new offset. Live routing schedules ingests. */
  const routeFile = (file: string, from: number, live: boolean): number => {
    if (!existsSync(file)) return from;
    const batches = new Map<string, string[]>();
    const triggers: Array<[string, string]> = [];
    const next = forEachLine(
      file,
      (line) => {
        if (!line.trim()) return;
        let sid: unknown;
        let ev: unknown;
        try {
          const parsed = JSON.parse(line) as { payload?: { session_id?: unknown; hook_event_name?: unknown } };
          sid = parsed.payload?.session_id;
          ev = parsed.payload?.hook_event_name;
        } catch {
          return; // a spliced concurrent append; the adapter would skip it too
        }
        // Ids and event names come from a file other processes append to; only plain tokens reach paths and logs.
        if (!isSafeId(sid) || !isSafeId(ev)) return;
        const list = batches.get(sid) ?? [];
        list.push(line);
        batches.set(sid, list);
        const s = seen.get(sid) ?? { ended: false, last_event: ev };
        s.last_event = ev;
        if (ev === "SessionEnd") s.ended = true;
        seen.set(sid, s);
        if (ev === "Stop" || ev === "SessionEnd") triggers.push([sid, ev]);
      },
      from,
    );
    for (const [sid, lines] of batches) {
      const dir = sessionDir(opts.captureDir, sid);
      ensurePrivateDir(dir);
      appendFileSync(join(dir, SESSION_HOOKS_FILE), lines.join("\n") + "\n", { mode: PRIVATE_FILE_MODE });
    }
    if (live) for (const [sid, ev] of triggers) pacer.trigger(sid, ev);
    return next;
  };

  /** One routing pass: drain a rotated inbox, route new inbox bytes, rotate when due. */
  const routeOnce = (live: boolean) => {
    const before = JSON.stringify(state);
    if (state.rotating && existsSync(rotating)) {
      state.rotating.offset = routeFile(rotating, state.rotating.offset, live);
      // A hook that opened the inbox just before the rename appends to the old file. Two quiet polls
      // after the rename it is safe to remove.
      if (++drainPolls >= 2 && state.rotating.offset >= statSync(rotating).size) {
        unlinkSync(rotating);
        delete state.rotating;
        drainPolls = 0;
      }
    } else if (state.rotating) {
      delete state.rotating;
    }
    if (existsSync(inbox)) {
      const st = statSync(inbox);
      const size = st.size;
      // A new inbox (after rotation, or replaced by hand) or a truncated one: start over.
      if (size < state.offset || (state.ino !== undefined && state.ino !== st.ino)) state.offset = 0;
      state.ino = st.ino;
      state.offset = routeFile(inbox, state.offset, live);
      if (!state.rotating && state.offset >= size && size >= rotateBytes) {
        renameSync(inbox, rotating);
        state.rotating = { offset: state.offset };
        state.offset = 0;
        delete state.ino;
        drainPolls = 0;
      }
    }
    if (JSON.stringify(state) !== before) saveState();
  };

  // ---- one-time migration from the shared-file layout -------------------------

  const migrate = () => {
    const shared = join(opts.captureDir, SESSION_OTLP_FILE);
    if (existsSync(shared)) {
      const started = Date.now();
      let lines = 0;
      const pending = new Map<string, string[]>();
      const flush = () => {
        for (const [sid, list] of pending) {
          const dir = sessionDir(opts.captureDir, sid);
          ensurePrivateDir(dir);
          appendFileSync(join(dir, SESSION_OTLP_FILE), list.join("\n") + "\n", { mode: PRIVATE_FILE_MODE });
        }
        pending.clear();
      };
      const take = (line: string) => {
        if (!line.trim()) return;
        let w: { received_at?: string; payload?: unknown };
        try {
          w = JSON.parse(line) as typeof w;
        } catch {
          return;
        }
        for (const [sid, slice] of splitLogsBySession(w.payload)) {
          const list = pending.get(sid) ?? [];
          list.push(JSON.stringify({ received_at: w.received_at, payload: slice }));
          pending.set(sid, list);
        }
        if (++lines % 2000 === 0) flush(); // bounded memory on a large file
      };
      const end = forEachLine(shared, take);
      const size = statSync(shared).size;
      if (end < size) take(readFileSync(shared).subarray(end).toString("utf8")); // a last line without a newline
      flush();
      unlinkSync(shared);
      log(`claude-code: moved telemetry into per-session folders (${lines} exports, ${Date.now() - started} ms)`);
    }
    for (const unused of ["otlp-metrics.ndjson", "otlp-traces.ndjson"]) {
      const p = join(opts.captureDir, unused);
      if (existsSync(p)) {
        unlinkSync(p);
        log(`claude-code: removed ${unused}, which Postrun never read`);
      }
    }
  };

  // ---- clean-up -----------------------------------------------------------------

  const folderIdleSince = (dir: string): number => {
    let newest = 0;
    for (const f of [SESSION_HOOKS_FILE, SESSION_OTLP_FILE]) {
      const p = join(dir, f);
      if (existsSync(p)) newest = Math.max(newest, statSync(p).mtimeMs);
    }
    return newest || statSync(dir).mtimeMs;
  };

  const sessionFolders = (): string[] => (existsSync(sessionsDir(opts.captureDir)) ? readdirSync(sessionsDir(opts.captureDir)).filter(isSafeId) : []);

  const cleanUp = (now = Date.now()): string[] => {
    if (!Number.isFinite(retainMs)) return [];
    const removed: string[] = [];
    for (const id of sessionFolders()) {
      const dir = sessionDir(opts.captureDir, id);
      if (now - folderIdleSince(dir) < retainMs || pacer.pending(id)) continue;
      // Store it one final time from the folder; delete only when that succeeded.
      if (!ingest(id, "final")) continue;
      rmSync(dir, { recursive: true, force: true });
      seen.delete(id);
      removed.push(id);
    }
    if (removed.length) log(`claude-code: removed the raw capture files of ${removed.length} session(s) idle for ${Math.round(retainMs / 3_600_000)} h; they are kept in the store`);
    return removed;
  };

  // ---- lifecycle ------------------------------------------------------------------

  return {
    start() {
      if (running) return;
      running = true;
      ensurePrivateDir(opts.captureDir);
      try {
        const saved = JSON.parse(readFileSync(statePath, "utf8")) as RouterState;
        if (typeof saved.offset === "number") state = saved;
      } catch {
        /* first run, or an unreadable state file: route the inbox from the start */
      }
      migrate();
      routeOnce(false); // backlog: route without per-line ingests, then catch up below
      for (const id of sessionFolders()) if (!seen.has(id)) seen.set(id, { ended: false, last_event: "" });
      // Catch up: anything not complete in the store may have changed while capture was stopped.
      const complete = new Set(opts.store.listSessions({ agent: "claude-code" }).filter((s) => s.ended_at).map((s) => s.id));
      const pending = sessionFolders().filter((id) => !complete.has(id));
      log(`claude-code: routing ${inbox} into ${sessionsDir(opts.captureDir)} (${seen.size} session folder(s), ${pending.length} to catch up)`);
      for (const id of pending) ingest(id, "startup");
      cleanUp();
      timer = setInterval(() => {
        try {
          routeOnce(true);
        } catch (err) {
          log(`claude-code: routing failed: ${(err as Error).message}`);
        }
      }, pollMs);
      cleanTimer = setInterval(() => cleanUp(), 10 * 60 * 1000);
      cleanTimer.unref?.();
    },
    stop() {
      running = false;
      if (timer) clearInterval(timer);
      if (cleanTimer) clearInterval(cleanTimer);
      pacer.cancelAll();
    },
    ingest,
    sessions: () => new Map(seen),
    cleanUp,
  };
}
