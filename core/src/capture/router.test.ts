/**
 * Per-session capture folders: inbox routing, rotation, restarts, the one-time
 * migration from shared files, and clean-up of finished sessions. Synthetic.
 */

import { appendFileSync, existsSync, mkdtempSync, readFileSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PostrunStore } from "../store/store.js";
import { createClaudeCodeWatcher } from "./claude-code-watcher.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hook = (sid: string, at: string, ev: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ received_at: at, channel: "hook", payload: { session_id: sid, hook_event_name: ev, cwd: "/w", ...extra } });
const turn = (sid: string, n: number) => [
  hook(sid, `2026-10-06T10:${String(n).padStart(2, "0")}:00Z`, "UserPromptSubmit", { prompt_id: `${sid}-p${n}`, prompt: `prompt ${n}` }),
  hook(sid, `2026-10-06T10:${String(n).padStart(2, "0")}:01Z`, "PostToolUse", { prompt_id: `${sid}-p${n}`, tool_use_id: `${sid}-t${n}`, tool_name: "Bash", tool_input: { command: `echo ${n}` }, tool_response: { stdout: "x".repeat(2000) } }),
  hook(sid, `2026-10-06T10:${String(n).padStart(2, "0")}:02Z`, "Stop", { prompt_id: `${sid}-p${n}`, last_assistant_message: `done ${n}` }),
];
const lines = (p: string) => readFileSync(p, "utf8").trim().split("\n").filter(Boolean);

describe("capture routing into per-session folders", () => {
  it("routes interleaved sessions, rotates the inbox without losing late appends, and never duplicates on restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-route-"));
    const inbox = join(dir, "hooks.ndjson");
    writeFileSync(inbox, [...turn("s-a", 1), ...turn("s-b", 1)].join("\n") + "\n");
    const store = new PostrunStore({ path: ":memory:" });
    const w = createClaudeCodeWatcher({ captureDir: dir, store, pollMs: 20, debounceMs: 30, rotateBytes: 4000 });
    w.start();
    expect(lines(join(dir, "sessions", "s-a", "hooks.ndjson"))).toHaveLength(3);
    expect(lines(join(dir, "sessions", "s-b", "hooks.ndjson"))).toHaveLength(3);
    expect(store.getSession("s-a")!.steps).toHaveLength(3);
    // The routed inbox was over the rotation size: it was renamed away.
    expect(existsSync(join(dir, "hooks.ndjson.routing"))).toBe(true);
    // A hook that opened the old file just before the rename still lands in it; it is drained, not lost.
    appendFileSync(join(dir, "hooks.ndjson.routing"), turn("s-a", 2).join("\n") + "\n");
    appendFileSync(inbox, turn("s-b", 2).join("\n") + "\n");
    await sleep(300);
    expect(existsSync(join(dir, "hooks.ndjson.routing"))).toBe(false);
    expect(lines(join(dir, "sessions", "s-a", "hooks.ndjson"))).toHaveLength(6);
    expect(lines(join(dir, "sessions", "s-b", "hooks.ndjson"))).toHaveLength(6);
    expect(store.getSession("s-a")!.steps).toHaveLength(6); // the late Stop triggered an ingest
    w.stop();

    // Restart: the saved read position means nothing is routed twice.
    appendFileSync(inbox, turn("s-a", 3).join("\n") + "\n");
    const w2 = createClaudeCodeWatcher({ captureDir: dir, store, pollMs: 20, debounceMs: 30, rotateBytes: 1e9 });
    w2.start();
    expect(lines(join(dir, "sessions", "s-a", "hooks.ndjson"))).toHaveLength(9);
    expect(lines(join(dir, "sessions", "s-b", "hooks.ndjson"))).toHaveLength(6);
    expect(store.getSession("s-a")!.steps).toHaveLength(9); // caught up on start
    w2.stop();
    store.close();
  });

  it("moves an old shared telemetry file into the session folders once, and removes metrics and traces", () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-migrate-"));
    const rec = (sid: string, seq: number) => ({
      attributes: [
        { key: "event.name", value: { stringValue: "user_prompt" } },
        { key: "event.sequence", value: { intValue: seq } },
        { key: "event.timestamp", value: { stringValue: `2026-10-06T10:00:0${seq}.000Z` } },
        { key: "session.id", value: { stringValue: sid } },
        { key: "prompt.id", value: { stringValue: `${sid}-p1` } },
      ],
    });
    const wrapper = { received_at: "2026-10-06T10:00:09Z", payload: { resourceLogs: [{ scopeLogs: [{ logRecords: [rec("s-a", 1), rec("s-b", 2)] }] }] } };
    writeFileSync(join(dir, "otlp-logs.ndjson"), JSON.stringify(wrapper) + "\n" + JSON.stringify(wrapper)); // last line without a newline
    writeFileSync(join(dir, "otlp-metrics.ndjson"), "{}\n");
    writeFileSync(join(dir, "otlp-traces.ndjson"), "{}\n");
    writeFileSync(join(dir, "hooks.ndjson"), turn("s-a", 1).join("\n") + "\n");
    const logs: string[] = [];
    const store = new PostrunStore({ path: ":memory:" });
    const w = createClaudeCodeWatcher({ captureDir: dir, store, log: (l) => logs.push(l) });
    w.start();
    w.stop();
    for (const f of ["otlp-logs.ndjson", "otlp-metrics.ndjson", "otlp-traces.ndjson"]) expect(existsSync(join(dir, f))).toBe(false);
    expect(lines(join(dir, "sessions", "s-a", "otlp-logs.ndjson"))).toHaveLength(2);
    expect(lines(join(dir, "sessions", "s-b", "otlp-logs.ndjson"))).toHaveLength(2);
    expect(logs.some((l) => /moved telemetry into per-session folders \(2 exports/.test(l))).toBe(true);
    store.close();
  });

  it("deletes a session's raw files only after it has been idle for the retention period, storing it first", () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-clean-"));
    writeFileSync(join(dir, "hooks.ndjson"), [...turn("s-old", 1), ...turn("s-new", 1)].join("\n") + "\n");
    const store = new PostrunStore({ path: ":memory:" });
    const w = createClaudeCodeWatcher({ captureDir: dir, store, retainMs: 60_000 });
    w.start();
    w.stop();
    const old = join(dir, "sessions", "s-old");
    const longAgo = new Date(Date.now() - 120_000);
    utimesSync(join(old, "hooks.ndjson"), longAgo, longAgo);
    expect(w.cleanUp()).toEqual(["s-old"]);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(join(dir, "sessions", "s-new"))).toBe(true);
    expect(store.getSession("s-old")!.steps).toHaveLength(3); // still reviewable and exportable
    store.close();
  });

  it("keeps raw files when POSTRUN_KEEP_CAPTURES=1", () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-keep-"));
    writeFileSync(join(dir, "hooks.ndjson"), turn("s-k", 1).join("\n") + "\n");
    process.env["POSTRUN_KEEP_CAPTURES"] = "1";
    try {
      const w = createClaudeCodeWatcher({ captureDir: dir, store: new PostrunStore({ path: ":memory:" }), retainMs: 0 });
      w.start();
      w.stop();
      expect(w.cleanUp(Date.now() + 1e9)).toEqual([]);
      expect(existsSync(join(dir, "sessions", "s-k"))).toBe(true);
    } finally {
      delete process.env["POSTRUN_KEEP_CAPTURES"];
    }
  });

  it("starts over when the inbox is replaced, even by a larger file", () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-trunc-"));
    writeFileSync(join(dir, "hooks.ndjson"), [...turn("s-a", 1), ...turn("s-a", 2)].join("\n") + "\n");
    const store = new PostrunStore({ path: ":memory:" });
    const w = createClaudeCodeWatcher({ captureDir: dir, store, rotateBytes: 1e9 });
    w.start();
    w.stop();
    renameSync(join(dir, "hooks.ndjson"), join(dir, "old"));
    // Larger than the old file, so only its identity shows it is new.
    writeFileSync(join(dir, "hooks.ndjson"), [...turn("s-c", 1), ...turn("s-c", 2), ...turn("s-c", 3)].join("\n") + "\n");
    const w2 = createClaudeCodeWatcher({ captureDir: dir, store, rotateBytes: 1e9 });
    w2.start();
    w2.stop();
    expect(lines(join(dir, "sessions", "s-c", "hooks.ndjson"))).toHaveLength(9);
    store.close();
  });
});
