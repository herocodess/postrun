/**
 * Cline live capture: watch ~/.cline/data/sessions and ingest sessions into the store.
 *
 * - Startup: ingest every session whose files changed since it was last
 *   stored (new ones included). Unchanged history is not re-read.
 * - Change: when a <id>.messages.json or <id>.json changes, or a new session
 *   directory appears, ingest that session. Cline rewrites its whole messages
 *   file on every message, so ingests are paced (pacer.ts): a short wait after
 *   the latest change, and at most about 1% of a core per busy session, so a
 *   very long session is refreshed less often instead of costing more. Every
 *   ingest is an upsert that writes only changed steps. ended_at stays unset
 *   until the metadata file records it.
 * - Half-written JSON (Cline mid-write) fails to parse; the watcher logs it
 *   and waits for the next change instead of retrying in a loop.
 *
 * Read only: Cline's files are never written, and nothing is deleted.
 */

import { existsSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { clineRecord } from "../store/ingest.js";
import { createPacer } from "./pacer.js";
import type { PostrunStore } from "../store/store.js";
import type { IngestResult } from "../store/types.js";

export interface ClineWatcherOptions {
  /** ~/.cline/data/sessions */
  sessionsDir: string;
  store: PostrunStore;
  /** Wait after the latest change before re-reading (ms). */
  debounceMs?: number;
  /** Share of one core a busy session may use for re-reads (default 0.01). */
  budget?: number;
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

  const pacer = createPacer({ run: (id, why) => void ingest(id, why), minDelayMs: debounceMs, ...(opts.budget !== undefined ? { budget: opts.budget } : {}) });
  const schedule = (sessionId: string, trigger: string) => pacer.trigger(sessionId, trigger);

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
      // Skip sessions stored after their files last changed: unchanged history is never re-read.
      const storedAt = new Map(opts.store.listSessions({ agent: "cline" }).map((s) => [s.id, Date.parse(s.updated_at)]));
      let caughtUp = 0;
      for (const id of ids) {
        const m = mtimeOf(id);
        const at = storedAt.get(id);
        if (at !== undefined && at >= m) {
          known.set(id, m);
          continue;
        }
        known.set(id, 0);
        ingest(id, "startup");
        caughtUp++;
      }
      log(`cline: watching ${opts.sessionsDir} (${ids.length} session(s) present, ${caughtUp} new or changed)`);
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
      pacer.cancelAll();
    },
    ingest,
    sessions: () => new Map(known),
  };
}
