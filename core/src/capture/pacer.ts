/**
 * Paces re-ingests so the recorder never takes more than a small share of a
 * CPU core per busy session, however large the session grows.
 *
 * Each session's ingest is timed. The next one may start no sooner than
 * cost / budget after the last one finished: with the default 1% budget, an
 * ingest that took 20 ms can run again after 2 s, one that took 400 ms after
 * 40 s. Triggers that arrive in between are merged into the one pending run,
 * which also waits at least `minDelayMs` after the latest trigger (so the
 * agent's last writes have landed), but never more than `maxWaitMs` after the
 * first trigger it is holding, so a session that never goes quiet still updates.
 */

import { performance } from "node:perf_hooks";

export interface PacerOptions {
  /** Runs one ingest for a session. Its duration is the measured cost. */
  run: (id: string, trigger: string) => void;
  /** Minimum wait after the latest trigger before running (ms). */
  minDelayMs: number;
  /** Share of one core a busy session may use (0.01 = 1%). */
  budget?: number;
  /** Longest a trigger may wait (ms), whatever the budget says. */
  maxWaitMs?: number;
}

export interface Pacer {
  trigger(id: string, why: string): void;
  /** Whether a run is pending for this session. */
  pending(id: string): boolean;
  cancelAll(): void;
}

interface Slot {
  timer?: NodeJS.Timeout;
  target: number; // when the pending run fires
  firstAt: number; // when the oldest held trigger arrived
  why: string;
  lastEnd: number;
  lastCost: number;
}

export function createPacer(opts: PacerOptions): Pacer {
  const budget = opts.budget ?? 0.01;
  const maxWait = opts.maxWaitMs ?? 60_000;
  const slots = new Map<string, Slot>();

  const fire = (id: string) => {
    const s = slots.get(id);
    if (!s) return;
    delete s.timer;
    const start = performance.now();
    try {
      opts.run(id, s.why);
    } finally {
      s.lastCost = performance.now() - start;
      s.lastEnd = Date.now();
    }
  };

  return {
    trigger(id, why) {
      const now = Date.now();
      const s = slots.get(id) ?? { target: 0, firstAt: now, why, lastEnd: 0, lastCost: 0 };
      slots.set(id, s);
      const earliest = Math.max(now + opts.minDelayMs, s.lastEnd + s.lastCost / budget);
      if (!s.timer) s.firstAt = now;
      const target = Math.min(Math.max(s.timer ? s.target : 0, earliest), s.firstAt + Math.max(maxWait, opts.minDelayMs));
      s.why = why;
      if (s.timer && target === s.target) return;
      if (s.timer) clearTimeout(s.timer);
      s.target = target;
      s.timer = setTimeout(() => fire(id), Math.max(0, target - now));
    },
    pending: (id) => slots.get(id)?.timer !== undefined,
    cancelAll() {
      for (const s of slots.values()) if (s.timer) clearTimeout(s.timer);
      for (const s of slots.values()) delete s.timer;
    },
  };
}
