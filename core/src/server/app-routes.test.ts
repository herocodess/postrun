/**
 * The review app's own routes: verdicts, dashboard, projects, multi-session
 * export, and the background-process routes answering 501 without it.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Step } from "../schema/index.js";
import { PostrunStore } from "../store/index.js";
import { createPostrunServer, type PostrunServer } from "./server.js";

const at = new Date().toISOString();
function record(id: string, root: string, steps: Array<Partial<Step>>) {
  return {
    id,
    agent: { kind: "claude-code", version: "1" },
    workspace: { root },
    started_at: at,
    segments: [{ index: 0, start_reason: "startup", started_at: at, source_files: [] }],
    actors: [{ id: "root", type: "root" }],
    turns: [{ id: "turn:1", session_id: id, segment_index: 0, actor_id: "root", index: 1, started_at: at, step_ids: [] }],
    steps: steps.map((s, i) => ({ id: `s${i + 1}`, session_id: id, segment_index: 0, turn_id: "turn:1", actor_id: "root", seq: i + 1, at, decision: "auto", outcome: "ok", content_status: "inline", channels: ["hook"], flags: [], ...s }) as Step),
    metrics: { cost_usd: 0.1, api_requests: 1, tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 } },
    source: "test",
  };
}

describe("review app routes", () => {
  let app: PostrunServer;
  let url: string;
  const store = new PostrunStore({ path: ":memory:" });
  beforeAll(async () => {
    store.ingest(record("a1", "/w/api", [{ type: "command", outcome: "failed", payload: { command: "pnpm test" } }, { type: "edit", payload: { path: "/w/api/x.ts", is_full_write: false } }]));
    store.ingest(record("b1", "/w/web", [{ type: "command", payload: { command: "rm -rf dist" } }]));
    const ui = mkdtempSync(join(tmpdir(), "postrun-ui-"));
    writeFileSync(join(ui, "index.html"), "x");
    app = createPostrunServer({ port: 0, store, uiDir: ui, ingestToken: "t".repeat(32) });
    url = (await app.start()).url;
  });
  afterAll(async () => {
    await app.stop();
    store.close();
  });
  const put = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(new URL(path, url), { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("sets and clears a review, same origin and JSON only", async () => {
    expect((await put("/api/sessions/a1/verdict", { state: "approved", note: "fine" })).status).toBe(200);
    expect(store.getSession("a1")!.summary.verdict).toEqual({ state: "approved", note: "fine" });
    expect((await put("/api/sessions/a1/verdict", { state: "approved" }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await fetch(new URL("/api/sessions/a1/verdict", url), { method: "PUT", headers: { "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await put("/api/sessions/a1/verdict", { state: "maybe" })).status).toBe(400);
    expect((await put("/api/sessions/zz/verdict", { state: null })).status).toBe(404);
    const list = (await (await fetch(new URL("/api/sessions?verdict=none", url))).json()) as { sessions: Array<{ id: string }> };
    expect(list.sessions.map((s) => s.id)).toEqual(["b1"]);
    expect((await put("/api/sessions/a1/verdict", { state: null })).status).toBe(200);
    expect(store.getSession("a1")!.summary.verdict).toBeUndefined();
  });

  it("serves the dashboard, projects and a project's files", async () => {
    const d = (await (await fetch(new URL("/api/dashboard?days=7", url))).json()) as { totals: { sessions: number; flagged: number }; per_day: unknown[] };
    expect(d.totals.sessions).toBe(2);
    expect(d.totals.flagged).toBe(1); // rm -rf
    expect(d.per_day).toHaveLength(7);
    expect((await fetch(new URL("/api/dashboard?days=3", url))).status).toBe(400);
    const p = (await (await fetch(new URL("/api/projects", url))).json()) as { projects: Array<{ root: string }> };
    expect(p.projects.map((x) => x.root).sort()).toEqual(["/w/api", "/w/web"]);
    const f = (await (await fetch(new URL("/api/projects/files?root=%2Fw%2Fapi", url))).json()) as { files: Array<{ path: string }> };
    expect(f.files.map((x) => x.path)).toEqual(["/w/api/x.ts"]);
  });

  it("exports several sessions as one zip of redacted reports", async () => {
    const res = await fetch(new URL("/api/export?ids=a1,b1,missing", url));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).readUInt32LE(0)).toBe(0x04034b50);
    expect(buf.includes(Buffer.from(".html"))).toBe(true);
    expect((await fetch(new URL("/api/export?ids=", url))).status).toBe(400);
  });

  it("answers 501 for status and settings without the background process", async () => {
    expect((await fetch(new URL("/api/status", url))).status).toBe(501);
    expect((await put("/api/settings", { notify_failures: true })).status).toBe(501);
  });
});
