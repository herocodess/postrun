import { chmodSync, existsSync, mkdtempSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locateClineSession } from "../adapters/cline/index.js";
import type { Step } from "../schema/index.js";
import { PostrunStore, claudeCodeRecord, clineRecord, LOCAL_OWNER_ID, type SessionRecord } from "./index.js";

const CAPTURES = process.env["POSTRUN_CAPTURES"] ?? join(homedir(), ".postrun", "captures");
const CC_SESSION = process.env["POSTRUN_CC_SESSION"] ?? "3ac04cde-89b6-4e88-941b-72293de124c3";
const hasCaptures = existsSync(join(CAPTURES, "otlp-logs.ndjson")) && existsSync(join(CAPTURES, "hooks.ndjson"));
const CLINE = process.env["POSTRUN_CLINE_SESSION"] ?? "1788568010939_qp82o";
let hasCline = false;
try {
  hasCline = existsSync(locateClineSession(CLINE).messages_path);
} catch {
  hasCline = false;
}

function tinyRecord(id: string, startedAt: string): SessionRecord {
  const step: Step = {
    id: "s1",
    session_id: id,
    segment_index: 0,
    turn_id: "turn:1",
    actor_id: "root",
    seq: 0,
    at: startedAt,
    type: "command",
    decision: "auto",
    outcome: "failed",
    content_status: "reference_only",
    error: { type: "ShellError", message: "boom" },
    channels: ["otel"],
    payload: { output_ref: "/t.jsonl#x" },
    flags: [{ kind: "failed", severity: "warn", reason: "exit 1" }],
  };
  const msg: Step = { ...step, id: "s0", seq: -1, type: "message", decision: "n/a", outcome: "ok", content_status: "inline", payload: { role: "user", text: "fix it" }, flags: [] };
  delete (msg as { error?: unknown }).error;
  return {
    id,
    agent: { kind: "test", version: "0" },
    workspace: { root: "/w" },
    started_at: startedAt,
    segments: [{ index: 0, start_reason: "start", started_at: startedAt, source_files: ["x"] }],
    actors: [{ id: "root", type: "root" }],
    turns: [{ id: "turn:1", session_id: id, segment_index: 0, actor_id: "root", index: 1, started_at: startedAt, step_ids: [] }],
    steps: [msg, step],
    metrics: { cost_usd: 0.5, api_requests: 2, tokens: { input: 1, output: 2, cache_read: 3, cache_creation: 4 } },
    source: "test",
  };
}

describe("store (in-memory)", () => {
  it("ingests idempotently and projects counts, title, and turn step_ids on read", () => {
    const store = new PostrunStore({ path: ":memory:", capturedOn: "test-host" });
    const r1 = store.ingest(tinyRecord("a", "2026-09-01T00:00:00Z"));
    expect(r1.created).toBe(true);
    const c1 = store.counts();
    const r2 = store.ingest(tinyRecord("a", "2026-09-01T00:00:00Z"));
    expect(r2.created).toBe(false);
    expect(store.counts()).toEqual(c1);
    expect(c1).toEqual({ sessions: 1, segments: 1, actors: 1, turns: 1, steps: 2 });

    store.ingest(tinyRecord("b", "2026-09-02T00:00:00Z"));
    const list = store.listSessions();
    expect(list.map((s) => s.id)).toEqual(["b", "a"]); // newest first
    const a = list[1]!;
    expect(a.owner_id).toBe(LOCAL_OWNER_ID);
    expect(a.captured_on).toBe("test-host");
    expect(a.title).toBe("fix it");
    expect(a.step_counts).toEqual({ message: 1, command: 1 });
    expect(a.failed_count).toBe(1);
    expect(a.reference_only_count).toBe(1);
    expect(a.flag_count).toBe(1);
    expect(a.metrics.cost_usd).toBe(0.5);

    const full = store.getSession("a")!;
    expect(full.steps.map((s) => s.id)).toEqual(["s0", "s1"]);
    expect(full.turns[0]!.step_ids).toEqual(["s0", "s1"]);
    const cmd = full.steps[1]!;
    expect(cmd.error).toEqual({ type: "ShellError", message: "boom" });
    expect(cmd.flags).toHaveLength(1);
    if (cmd.type === "command") expect(cmd.payload.output_ref).toBe("/t.jsonl#x");
    expect(full.steps[0]!.error).toBeUndefined();
    expect(store.listSessions({ agent: "nope" })).toEqual([]);
    expect(store.getSession("missing")).toBeUndefined();
    store.close();
  });
});

describe("store on disk", () => {
  it("creates the directory 0700 and the database, wal, and shm files 0600, and tightens existing wide files", () => {
    const root = mkdtempSync(join(tmpdir(), "postrun-store-"));
    const dir = join(root, "data");
    const path = join(dir, "postrun.db");
    let store = new PostrunStore({ path });
    store.ingest(tinyRecord("a", "2026-09-01T00:00:00Z"));
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const suffix of ["", "-wal", "-shm"]) expect(statSync(path + suffix).mode & 0o777).toBe(0o600);
    store.close();
    // A pre-existing world-readable store from an older build is tightened on open.
    chmodSync(path, 0o644);
    chmodSync(dir, 0o755);
    store = new PostrunStore({ path });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(store.listSessions()).toHaveLength(1);
    store.close();
  });
});

describe.skipIf(!hasCaptures || !hasCline)("store with both real sessions", () => {
  it("ingests both, lists them newest-first, re-ingest leaves counts unchanged", () => {
    const store = new PostrunStore({ path: ":memory:" });
    const cc = store.ingest(claudeCodeRecord(CAPTURES, CC_SESSION));
    const cl = store.ingest(clineRecord(CLINE));
    expect(cc.steps).toBe(100);
    expect(cl.steps).toBe(195);
    const before = store.counts();
    expect(before.sessions).toBe(2);
    expect(before.steps).toBe(295);
    store.ingest(claudeCodeRecord(CAPTURES, CC_SESSION));
    store.ingest(clineRecord(CLINE));
    expect(store.counts()).toEqual(before);

    const list = store.listSessions();
    expect(list.map((s) => s.agent.kind)).toEqual(["cline", "claude-code"]);
    expect(store.listSessions({ agent: "cline" })).toHaveLength(1);
    const ccFull = store.getSession(cc.session_id)!;
    const gitPush = ccFull.steps.find((s) => s.seq === 604)!;
    expect(gitPush.content_status).toBe("reference_only");
    expect(gitPush.outcome).toBe("failed");
    const clFull = store.getSession(cl.session_id)!;
    expect(clFull.turns.some((t) => t.mode === "plan")).toBe(true);
    expect(clFull.segments).toHaveLength(4);
    expect(clFull.summary.metrics.cost_usd).toBeCloseTo(2.3777, 3);
    store.close();
  });
});
