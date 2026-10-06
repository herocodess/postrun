import { describe, expect, it } from "vitest";
import { createPacer } from "./pacer.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const busy = (ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* simulate an expensive ingest */
  }
};

describe("ingest pacer", () => {
  it("merges triggers into one run that waits for the latest trigger", async () => {
    const runs: Array<[string, number]> = [];
    const t0 = Date.now();
    const p = createPacer({ run: (id) => runs.push([id, Date.now() - t0]), minDelayMs: 60 });
    p.trigger("a", "Stop");
    await sleep(30);
    p.trigger("a", "SessionEnd");
    expect(p.pending("a")).toBe(true);
    await sleep(120);
    expect(runs).toHaveLength(1);
    expect(runs[0]![1]).toBeGreaterThanOrEqual(85); // 60 ms after the second trigger
    expect(p.pending("a")).toBe(false);
  });

  it("spaces runs by their measured cost, so a slow session uses at most its budget", async () => {
    const runs: number[] = [];
    const t0 = Date.now();
    // 30 ms per run at a 20% budget: at most one run every 150 ms.
    const p = createPacer({ run: () => (runs.push(Date.now() - t0), busy(30)), minDelayMs: 10, budget: 0.2, maxWaitMs: 10_000 });
    p.trigger("a", "x");
    await sleep(40);
    p.trigger("a", "x"); // right after the first run: must wait for the budget
    await sleep(60);
    expect(runs).toHaveLength(1);
    await sleep(150);
    expect(runs).toHaveLength(2);
    expect(runs[1]! - runs[0]!).toBeGreaterThanOrEqual(170); // 30 ms run + 150 ms gap, give or take a tick
  });

  it("still runs a session that never goes quiet, by maxWait", async () => {
    let runs = 0;
    const p = createPacer({ run: () => runs++, minDelayMs: 50, maxWaitMs: 150 });
    const until = Date.now() + 260;
    while (Date.now() < until) {
      p.trigger("busy", "change");
      await sleep(10);
    }
    expect(runs).toBeGreaterThanOrEqual(1);
    p.cancelAll();
  });

  it("keeps sessions independent", async () => {
    const runs: string[] = [];
    const p = createPacer({ run: (id) => runs.push(id), minDelayMs: 20 });
    p.trigger("a", "x");
    p.trigger("b", "x");
    await sleep(60);
    expect(runs.sort()).toEqual(["a", "b"]);
  });
});
