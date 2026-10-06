/**
 * Deleting one session: gone from the store and from the files on disk, never
 * re-imported, refused on push, visible to live views. Synthetic.
 */

import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createClaudeCodeWatcher } from "../capture/claude-code-watcher.js";
import type { Step } from "../schema/index.js";
import { createPostrunServer } from "../server/server.js";
import { DeletedSessionError, PostrunStore, type SessionRecord } from "./index.js";

const SECRET = "AKIA-NOT-REAL-postrun-delete-test-7f3a9c";
const at = "2026-10-06T10:00:00.000Z";

function record(id: string, kind = "claude-code"): SessionRecord {
  const step = {
    id: "s1",
    session_id: id,
    segment_index: 0,
    turn_id: "turn:1",
    actor_id: "root",
    seq: 1,
    at,
    type: "command",
    decision: "auto",
    outcome: "ok",
    content_status: "inline",
    channels: ["hook"],
    flags: [],
    payload: { command: "env | grep AWS", stdout: `AWS_ACCESS_KEY_ID=${SECRET}\n`.repeat(50) },
  } as Step;
  return {
    id,
    agent: { kind, version: "1" },
    workspace: { root: "/w" },
    started_at: at,
    segments: [{ index: 0, start_reason: "startup", started_at: at, source_files: [] }],
    actors: [{ id: "root", type: "root" }],
    turns: [{ id: "turn:1", session_id: id, segment_index: 0, actor_id: "root", index: 1, started_at: at, step_ids: [] }],
    steps: [step],
    metrics: { cost_usd: 0, api_requests: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 } },
    source: "test",
  };
}

describe("deleting a session", () => {
  it("is not undone by a capture that checked just before the delete landed", () => {
    const store = new PostrunStore({ path: ":memory:" });
    store.ingest(record("racy"));
    store.deleteSession("racy");
    // The recorder's first check ran before the delete (it saw "not deleted"); its write comes after.
    const spy = vi.spyOn(store, "isDeleted").mockReturnValueOnce(false);
    expect(() => store.ingest(record("racy"))).toThrow(DeletedSessionError);
    spy.mockReturnValueOnce(false);
    expect(() =>
      store.appendBatch({ session: { id: "racy", agent: { kind: "claude-code", version: "1" }, workspace: { root: "/w" }, started_at: at }, segments: [], actors: [], turns: [], steps: [] }),
    ).toThrow(DeletedSessionError);
    spy.mockRestore();
    expect(store.getSession("racy")).toBeUndefined();
    store.close();
  });

  it("removes it from the store and from the bytes on disk, and refuses it ever after", () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-del-"));
    const path = join(dir, "postrun.db");
    const store = new PostrunStore({ path });
    store.ingest(record("keep"));
    store.ingest(record("gone"));
    const before = store.lastUpdatedAt()!;
    expect(store.deleteSession("gone")).toMatchObject({ id: "gone", agent_kind: "claude-code" });
    expect(store.getSession("gone")).toBeUndefined();
    expect(store.listSessions().map((s) => s.id)).toEqual(["keep"]);
    expect(store.counts().steps).toBe(1);
    expect(store.isDeleted("gone")).toBe(true);
    expect(store.deleteSession("gone")).toBeUndefined();
    // Live views learn of it.
    expect(store.changedSince(before).map((c) => c.id)).toContain("gone");
    expect(store.lastUpdatedAt()! >= before).toBe(true);
    // Capture and pushes cannot bring it back.
    expect(() => store.ingest(record("gone"))).toThrow(DeletedSessionError);
    expect(() =>
      store.appendBatch({ session: { id: "gone", agent: { kind: "claude-code", version: "1" }, workspace: { root: "/w" }, started_at: at }, segments: [], actors: [], turns: [], steps: [] }),
    ).toThrow(DeletedSessionError);
    // The other session's copy of the secret is still there; delete it too, then no copy is left on disk.
    store.deleteSession("keep");
    store.close();
    for (const f of [path, `${path}-wal`]) {
      if (existsSync(f)) expect(readFileSync(f).includes(Buffer.from(SECRET)), f).toBe(false);
    }
  });

  it("stops the recorder writing a deleted Claude Code session, and removes its folder", async () => {
    const cap = mkdtempSync(join(tmpdir(), "postrun-delcap-"));
    const hook = (ev: string, x: Record<string, unknown> = {}) => JSON.stringify({ received_at: at.replace(".000", ""), channel: "hook", payload: { session_id: "cc-del", hook_event_name: ev, cwd: "/w", ...x } });
    writeFileSync(join(cap, "hooks.ndjson"), [hook("UserPromptSubmit", { prompt_id: "p1", prompt: "hi" }), hook("Stop", { prompt_id: "p1", last_assistant_message: "ok" })].join("\n") + "\n");
    const store = new PostrunStore({ path: ":memory:" });
    const logs: string[] = [];
    const w = createClaudeCodeWatcher({ captureDir: cap, store, pollMs: 20, debounceMs: 20, log: (l) => logs.push(l) });
    w.start();
    expect(store.getSession("cc-del")).toBeDefined();
    store.deleteSession("cc-del");
    // The agent keeps going: its events are dropped, the folder removed, nothing stored.
    appendFileSync(join(cap, "hooks.ndjson"), [hook("UserPromptSubmit", { prompt_id: "p2", prompt: "more" }), hook("Stop", { prompt_id: "p2", last_assistant_message: "ok" })].join("\n") + "\n");
    await new Promise((r) => setTimeout(r, 200));
    expect(store.getSession("cc-del")).toBeUndefined();
    expect(existsSync(join(cap, "sessions", "cc-del")), logs.join("\n")).toBe(false);
    w.stop();
    store.close();
  });

  it("DELETE /api/sessions/:id works from the review app and refuses other sites", async () => {
    const cap = mkdtempSync(join(tmpdir(), "postrun-delsrv-"));
    const ui = mkdtempSync(join(tmpdir(), "postrun-ui-"));
    writeFileSync(join(ui, "index.html"), "<!doctype html><title>t</title>");
    const store = new PostrunStore({ path: ":memory:" });
    store.ingest(record("srv-1"));
    store.ingest(record("srv-2"));
    writeFileSync(join(mkdtempSync(join(tmpdir(), "x-")), "x"), "");
    const sessionFolder = join(cap, "sessions", "srv-1");
    (await import("node:fs")).mkdirSync(sessionFolder, { recursive: true });
    writeFileSync(join(sessionFolder, "hooks.ndjson"), "{}\n");
    const app = createPostrunServer({ port: 0, store, uiDir: ui, captureDir: cap, ingestToken: "t".repeat(32) });
    const { url } = await app.start();
    const del = (id: string, headers: Record<string, string> = {}) => fetch(new URL(`/api/sessions/${id}`, url), { method: "DELETE", headers });

    expect((await del("srv-2", { origin: "https://evil.example" })).status).toBe(403);
    expect((await del("srv-2", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(store.getSession("srv-2")).toBeDefined();

    const ok = await del("srv-1", { origin: url.replace(/\/$/, ""), "sec-fetch-site": "same-origin" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ deleted: true, id: "srv-1", agent_kind: "claude-code", removed_capture_files: true });
    expect(existsSync(sessionFolder)).toBe(false);
    expect((await fetch(new URL("/api/sessions/srv-1", url))).status).toBe(404);
    expect((await del("srv-1")).status).toBe(404);
    // A push for the deleted session is refused as gone.
    const push = await fetch(new URL("/api/ingest", url), {
      method: "POST",
      headers: { authorization: `Bearer ${"t".repeat(32)}`, "content-type": "application/json" },
      body: JSON.stringify({ schema_version: "1.2", session: { id: "srv-1", agent: { kind: "claude-code", version: "1" }, workspace: { root: "/w" }, started_at: at } }),
    });
    expect(push.status).toBe(410);
    await app.stop();
    store.close();
  });
});

describe("deleting with the search index", () => {
  it("leaves no copy of a deleted session's output in the search index", () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-del-fts-"));
    const path = join(dir, "postrun.db");
    const store = new PostrunStore({ path });
    const other = record("other");
    (other.steps[0] as { payload: { stdout: string } }).payload.stdout = "nothing secret here\n".repeat(50);
    store.ingest(other);
    store.ingest(record("gone"));
    expect(store.querySessions({ q: SECRET.slice(0, 20) }).sessions.map((s) => s.id)).toEqual(["gone"]);
    store.deleteSession("gone");
    expect(store.querySessions({ q: SECRET.slice(0, 20) }).total).toBe(0);
    store.close();
    for (const f of [path, `${path}-wal`]) {
      if (existsSync(f)) expect(readFileSync(f).includes(Buffer.from(SECRET)), f).toBe(false);
    }
  });
});
