/**
 * Cline live capture: watch ~/.cline/data/sessions and ingest sessions into the store.
 *
 * - Startup: ingest every session directory found (idempotent).
 * - Change: when a <id>.messages.json or <id>.json changes, or a new session
 *   directory appears, ingest that session after a short debounce. Cline
 *   rewrites the messages file during the session, so a session is ingested
 *   repeatedly while open; every ingest is an upsert. ended_at stays unset
 *   until the metadata file records it.
 * - Half-written JSON (Cline mid-write) fails to parse; the watcher logs it
 *   and waits for the next change instead of retrying in a loop.
 *
 * Read only: Cline's files are never written, and nothing is deleted.
 */

import { existsSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { clineRecord } from "../store/ingest.js";
import type { PostrunStore } from "../store/store.js";
import type { IngestResult } from "../store/types.js";

export interface ClineWatcherOptions {
  /** ~/.cline/data/sessions */
  sessionsDir: string;
  store: PostrunStore;
  /** Debounce per session after a change (ms). */
  debounceMs?: number;
  /** Fallback poll interval for mtime changes (ms); fs.watch is the fast path. */
  pollMs?: number;
  log?: (line: string) => void;
  onIngest?: (result: IngestResult, trigger: string) => void;
}

export interface ClineWatcher {
  start(): void;
  stop(): void;
  ingest(sessionId: string, trigger?: string): IngestResult | undefined;
  /** Session ids currently known, with the last mtime seen. */
  sessions(): Map<string, number>;
}

export function createClineWatcher(opts: ClineWatcherOptions): ClineWatcher {
  const debounceMs = opts.debounceMs ?? 2000;
  const pollMs = opts.pollMs ?? 3000;
  const log = opts.log ?? (() => undefined);
  const known = new Map<string, number>(); // session id -> last mtime ingested or seen
  const timers = new Map<string, NodeJS.Timeout>();
  let watcher: FSWatcher | undefined;
  let poll: NodeJS.Timeout | undefined;

  // Session directory names are file system entries; only plain tokens are used to build paths or logged.
  const SAFE_ID = /^[A-Za-z0-9_.-]{1,128}$/;
  const sessionDir = (id: string) => join(opts.sessionsDir, id);
  const mtimeOf = (id: string): number => {
    const dir = sessionDir(id);
    let latest = 0;
    for (const f of [`${id}.messages.json`, `${id}.json`]) {
      const p = join(dir, f);
      if (existsSync(p)) latest = Math.max(latest, statSync(p).mtimeMs);
    }
    return latest;
  };

  const ingest = (sessionId: string, trigger = "on-demand"): IngestResult | undefined => {
    try {
      const record = clineRecord(sessionDir(sessionId));
      const result = opts.store.ingest(record);
      known.set(sessionId, mtimeOf(sessionId));
      log(`cline ${result.created ? "ingested" : "updated"} ${sessionId} (${result.steps} steps, ${result.turns} turns) on ${trigger}`);
      opts.onIngest?.(result, trigger);
      return result;
    } catch (err) {
      const msg = (err as Error).message;
      if (/JSON/.test(msg)) log(`cline ${sessionId}: messages file not parseable yet (mid-write?); will retry on next change`);
      else log(`cline ${sessionId}: ingest failed on ${trigger}: ${msg}`);
      return undefined;
    }
  };

  const schedule = (sessionId: string, trigger: string) => {
    const existing = timers.get(sessionId);
    if (existing) clearTimeout(existing);
    timers.set(
      sessionId,
      setTimeout(() => {
        timers.delete(sessionId);
        ingest(sessionId, trigger);
      }, debounceMs),
    );
  };

  const listSessions = (): string[] => {
    if (!existsSync(opts.sessionsDir)) return [];
    return readdirSync(opts.sessionsDir).filter((d) => SAFE_ID.test(d) && existsSync(join(opts.sessionsDir, d, `${d}.messages.json`)));
  };

  const scan = (trigger: string) => {
    for (const id of listSessions()) {
      const m = mtimeOf(id);
      const last = known.get(id);
      if (last === undefined) {
        known.set(id, 0);
        schedule(id, `${trigger}:new`);
      } else if (m > last) {
        schedule(id, `${trigger}:changed`);
      }
    }
  };

  return {
    start() {
      const ids = listSessions();
      log(`cline: watching ${opts.sessionsDir} (${ids.length} session(s) present)`);
      for (const id of ids) {
        known.set(id, 0);
        ingest(id, "startup");
      }
      if (existsSync(opts.sessionsDir)) {
        try {
          watcher = watch(opts.sessionsDir, { recursive: true }, (_event, filename) => {
            const name = filename == null ? undefined : String(filename);
            if (!name) return;
            const id = name.split(/[\\/]/)[0];
            if (!id || !SAFE_ID.test(id)) return;
            if (!/\.(messages\.)?json$/.test(name) && !existsSync(join(opts.sessionsDir, id, `${id}.messages.json`))) return;
            if (!known.has(id)) known.set(id, 0);
            schedule(id, "watch");
          });
          watcher.on("error", (err) => log(`cline: fs.watch error: ${err.message}; polling continues`));
        } catch (err) {
          log(`cline: fs.watch unavailable (${(err as Error).message}); polling only`);
        }
      }
      poll = setInterval(() => scan("poll"), pollMs);
    },
    stop() {
      watcher?.close();
      if (poll) clearInterval(poll);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
    ingest,
    sessions: () => new Map(known),
  };
}
