import { chmodSync, existsSync, mkdtempSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "./sqlite.js";
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

/** The version 1 schema, verbatim, to prove a store from the previous release upgrades in place. */
const V1_DDL = `CREATE TABLE IF NOT EXISTS sessions (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL,
  captured_on          TEXT NOT NULL,
  agent_kind           TEXT NOT NULL,
  agent_version        TEXT NOT NULL,
  agent_format_version TEXT,
  workspace_root       TEXT NOT NULL,
  workspace_repo       TEXT,
  started_at           TEXT NOT NULL,
  ended_at             TEXT,
  source               TEXT NOT NULL,
  cost_usd             REAL NOT NULL DEFAULT 0,
  api_requests         INTEGER NOT NULL DEFAULT 0,
  tokens_input         INTEGER NOT NULL DEFAULT 0,
  tokens_output        INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read    INTEGER NOT NULL DEFAULT 0,
  tokens_cache_creation INTEGER NOT NULL DEFAULT 0,
  verdict_state        TEXT,
  verdict_note         TEXT,
  verdict_reviewer     TEXT,
  ingested_at          TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner_id);

CREATE TABLE IF NOT EXISTS segments (
  session_id   TEXT NOT NULL REFERENCES sessions(id),
  idx          INTEGER NOT NULL,
  start_reason TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  source_files TEXT NOT NULL,
  PRIMARY KEY (session_id, idx)
);

CREATE TABLE IF NOT EXISTS actors (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  id         TEXT NOT NULL,
  parent_id  TEXT,
  type       TEXT NOT NULL,
  label      TEXT,
  PRIMARY KEY (session_id, id)
);

CREATE TABLE IF NOT EXISTS turns (
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  id            TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  actor_id      TEXT NOT NULL,
  idx           INTEGER NOT NULL,
  prompt_id     TEXT,
  mode          TEXT,
  started_at    TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
);

CREATE TABLE IF NOT EXISTS steps (
  session_id     TEXT NOT NULL REFERENCES sessions(id),
  id             TEXT NOT NULL,
  segment_index  INTEGER NOT NULL,
  turn_id        TEXT NOT NULL,
  actor_id       TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  at             TEXT NOT NULL,
  type           TEXT NOT NULL,
  decision       TEXT NOT NULL,
  outcome        TEXT NOT NULL,
  content_status TEXT NOT NULL,
  error_type     TEXT,
  error_message  TEXT,
  channels       TEXT NOT NULL,
  payload        TEXT NOT NULL,
  flags          TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
);
CREATE INDEX IF NOT EXISTS steps_session_seq ON steps(session_id, seq);
CREATE INDEX IF NOT EXISTS steps_session_turn ON steps(session_id, turn_id, seq);`;

describe("store writes only what changed (schema v2)", () => {
  it("skips unchanged steps, leaves updated_at alone when nothing changed, and writes only new or changed steps", async () => {
    const store = new PostrunStore({ path: ":memory:" });
    const r = tinyRecord("w1", "2026-10-06T10:00:00.000Z");
    const first = store.ingest(r);
    expect(first).toMatchObject({ created: true, changed: true, written: 2 });
    const t1 = store.getSession("w1")!.summary.updated_at;
    await new Promise((res) => setTimeout(res, 5));
    const again = store.ingest(r);
    expect(again).toMatchObject({ created: false, changed: false, written: 0 });
    expect(store.getSession("w1")!.summary.updated_at).toBe(t1); // a re-read wakes no live view

    const extra: Step = { ...r.steps[0]!, id: "s2", seq: 5, payload: { role: "assistant", text: "done" } } as Step;
    const grown = { ...r, steps: [...r.steps, extra] };
    const third = store.ingest(grown);
    expect(third).toMatchObject({ changed: true, written: 1 });
    const t3 = store.getSession("w1")!.summary.updated_at;
    expect(t3 > t1).toBe(true);
    // Only the new step is newer than the earlier read.
    expect(store.stepsChangedSince("w1", t1)).toEqual({ steps: [expect.objectContaining({ id: "s2" })], reload: false });
    expect(store.stepsChangedSince("w1", t3).steps).toEqual([]);
    expect(store.getStep("w1", "s2")).toMatchObject({ id: "s2", payload: { text: "done" } });
    expect(store.getSession("w1")!.summary).toMatchObject({ steps_total: 3, failed_count: 1, title: "fix it", step_counts: { message: 2, command: 1 } });

    // Removing a step tells a delta reader to reload.
    await new Promise((res) => setTimeout(res, 5));
    store.ingest(r);
    expect(store.stepsChangedSince("w1", t3)).toEqual({ steps: [], reload: true });
    expect(store.getSession("w1")!.summary.steps_total).toBe(2);
    store.close();
  });

  it("upgrades a version 1 store in place: new columns, counts filled in, stored copies of original files dropped", () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-v1-"));
    const path = join(dir, "v1.db");
    const v1 = new Database(path);
    v1.exec(V1_DDL);
    v1.pragma("user_version = 1");
    v1.prepare(
      `INSERT INTO sessions (id, owner_id, captured_on, agent_kind, agent_version, workspace_root, started_at, source, ingested_at, updated_at)
       VALUES ('old', 'local', 'mac', 'claude-code', '2.1.0', '/w', '2026-09-01T10:00:00Z', 'x', '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z')`,
    ).run();
    v1.prepare("INSERT INTO turns (session_id, id, segment_index, actor_id, idx, started_at) VALUES ('old', 'turn:1', 0, 'root', 1, '2026-09-01T10:00:00Z')").run();
    const ins = v1.prepare(
      `INSERT INTO steps (session_id, id, segment_index, turn_id, actor_id, seq, at, type, decision, outcome, content_status, channels, payload, flags)
       VALUES ('old', ?, 0, 'turn:1', 'root', ?, '2026-09-01T10:00:00Z', ?, 'auto', ?, 'inline', '["hook"]', ?, '[]')`,
    );
    ins.run("m", 1, "message", "ok", JSON.stringify({ role: "user", text: "old prompt" }));
    ins.run("e", 2, "edit", "failed", JSON.stringify({ path: "/w/a.ts", is_full_write: false, old_string: "a", new_string: "b", structured_patch: { structuredPatch: [1], originalFile: "x".repeat(50_000) } }));
    v1.close();

    const store = new PostrunStore({ path });
    const s = store.getSession("old")!;
    expect(s.summary).toMatchObject({ title: "old prompt", steps_total: 2, failed_count: 1, turn_count: 1, step_counts: { message: 1, edit: 1 } });
    const edit = s.steps.find((x) => x.id === "e")!;
    expect(edit.type === "edit" && edit.payload.structured_patch).toEqual({ structuredPatch: [1] });
    expect(store.listSessions()).toHaveLength(1);
    store.close();
    // Opening again is a no-op.
    const again = new PostrunStore({ path });
    expect(again.getSession("old")!.summary.steps_total).toBe(2);
    again.close();
  });
});

describe("session strip", () => {
  it("records each step's type in order, upper case when it failed", async () => {
    const { PostrunStore: Store } = await import("./store.js");
    const store = new Store({ path: ":memory:" });
    const at = "2026-10-06T10:00:00.000Z";
    const base = { session_id: "strip-1", segment_index: 0, turn_id: "turn:1", actor_id: "root", at, decision: "auto", content_status: "inline", channels: ["hook"], flags: [] } as const;
    store.ingest({
      id: "strip-1",
      agent: { kind: "claude-code", version: "1" },
      workspace: { root: "/w" },
      started_at: at,
      segments: [{ index: 0, start_reason: "startup", started_at: at, source_files: [] }],
      actors: [{ id: "root", type: "root" }],
      turns: [{ id: "turn:1", session_id: "strip-1", segment_index: 0, actor_id: "root", index: 1, started_at: at, step_ids: [] }],
      steps: [
        { ...base, id: "a", seq: 1, type: "message", outcome: "ok", decision: "n/a", payload: { role: "user", text: "go" } },
        { ...base, id: "b", seq: 2, type: "command", outcome: "failed", payload: { command: "x" } },
        { ...base, id: "c", seq: 3, type: "edit", outcome: "ok", payload: { path: "/w/a", is_full_write: false } },
        { ...base, id: "d", seq: 4, type: "read", outcome: "ok", payload: { path: "/w/b" } },
      ] as never,
      metrics: { cost_usd: 0, api_requests: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 } },
      source: "test",
    });
    expect(store.getSession("strip-1")!.summary.strip).toBe("mCer");
    store.close();
  });

  it("slices a long strip, keeping any failure visible", async () => {
    const { sliceStrip } = await import("./store.js");
    expect(sliceStrip("cccc", 64)).toBe("cccc");
    const long = "e".repeat(1000) + "C" + "r".repeat(999);
    const s = sliceStrip(long, 10);
    expect(s).toHaveLength(10);
    expect(s.slice(0, 5)).toBe("eeeee");
    expect(s[5]).toBe("R"); // the slice holding the failed command is mostly reads, marked failed
  });
});
