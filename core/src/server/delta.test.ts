/**
 * Light live views: step previews, one-step fetch, and ?since= deltas. Synthetic.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Step } from "../schema/index.js";
import { PostrunStore, type SessionRecord } from "../store/index.js";
import type { SessionDeltaResponse, SessionDetailResponse, SessionListResponse, StepResponse } from "./api.js";
import { PREVIEW_CHARS } from "./preview.js";
import { createPostrunServer, type PostrunServer } from "./server.js";

const SID = "delta-session";
const at = "2026-10-06T10:00:00.000Z";
const base = { session_id: SID, segment_index: 0, turn_id: "turn:1", actor_id: "root", at, decision: "auto", outcome: "ok", content_status: "inline", channels: ["hook"], flags: [] } as const;
const step = (id: string, seq: number, rest: Partial<Step>) => ({ ...base, id, seq, ...rest }) as Step;
const BIG = "line of build output\n".repeat(20_000); // ~420 KB

function record(steps: Step[]): SessionRecord {
  return {
    id: SID,
    agent: { kind: "claude-code", version: "2.1.30" },
    workspace: { root: "/w" },
    started_at: at,
    segments: [{ index: 0, start_reason: "startup", started_at: at, source_files: ["hooks.ndjson"] }],
    actors: [{ id: "root", type: "root" }],
    turns: [{ id: "turn:1", session_id: SID, segment_index: 0, actor_id: "root", index: 1, started_at: at, step_ids: [] }],
    steps,
    metrics: { cost_usd: 0, api_requests: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 } },
    source: "test",
  };
}

const first = [
  step("m1", 1, { type: "message", decision: "n/a", payload: { role: "user", text: "build it" } }),
  step("c1", 2, { type: "command", payload: { command: "pnpm build", stdout: BIG, exit_code: 0 } }),
  step("e1", 3, { type: "edit", payload: { path: "/w/a.ts", is_full_write: false, old_string: "a", new_string: "b", structured_patch: { structuredPatch: [{ lines: ["-a", "+b"] }] } } }),
];

describe("light live views", () => {
  let app: PostrunServer;
  let url: string;
  const store = new PostrunStore({ path: ":memory:" });
  const uiDir = mkdtempSync(join(tmpdir(), "postrun-ui-"));
  writeFileSync(join(uiDir, "index.html"), "<!doctype html><title>t</title>");

  beforeAll(async () => {
    store.ingest(record(first));
    app = createPostrunServer({ port: 0, store, uiDir });
    url = (await app.start()).url;
  });
  afterAll(async () => {
    await app.stop();
    store.close();
  });

  const get = async <T>(path: string) => {
    const res = await fetch(new URL(path, url));
    return { status: res.status, bytes: Number(res.headers.get("content-length") ?? 0), body: (await res.json()) as T };
  };

  it("sends previews: long output cut to 2 KB with its full length, commands and paths kept, report intact", async () => {
    const { body, bytes } = await get<SessionDetailResponse>(`/api/sessions/${SID}`);
    const c1 = body.steps.find((s) => s.id === "c1")!;
    expect(c1.type === "command" && c1.payload.stdout!.length).toBe(PREVIEW_CHARS);
    expect(c1.truncated).toEqual({ stdout: BIG.length });
    expect(c1.type === "command" && c1.payload.command).toBe("pnpm build");
    const e1 = body.steps.find((s) => s.id === "e1")!;
    expect(e1.type === "edit" && e1.payload.structured_patch).toBeUndefined();
    expect(body.steps.find((s) => s.id === "m1")!.truncated).toBeUndefined();
    expect(body.report.commands.map((c) => c.command)).toEqual(["pnpm build"]);
    expect(body.report.files.map((f) => f.path)).toEqual(["/w/a.ts"]);
    expect(body.as_of).toBe(body.summary.updated_at);
    expect(bytes).toBeLessThan(20_000); // the 420 KB of output stays on the server
  });

  it("returns one step in full on request", async () => {
    const { status, body } = await get<StepResponse>(`/api/sessions/${SID}/steps/c1`);
    expect(status).toBe(200);
    expect(body.step.type === "command" && body.step.payload.stdout).toBe(BIG);
    expect((await get(`/api/sessions/${SID}/steps/nope`)).status).toBe(404);
  });

  it("answers ?since= with only the steps written after it, and asks for a reload after a removal", async () => {
    const { body: full } = await get<SessionDetailResponse>(`/api/sessions/${SID}`);
    await new Promise((r) => setTimeout(r, 5));
    store.ingest(record([...first, step("c2", 4, { type: "command", payload: { command: "pnpm test", stdout: "ok", exit_code: 0 } })]));
    const { body: d } = await get<SessionDeltaResponse>(`/api/sessions/${SID}?since=${encodeURIComponent(full.as_of)}`);
    expect(d.delta).toBe(true);
    expect(d.reload).toBe(false);
    expect(d.steps.map((s) => s.id)).toEqual(["c2"]);
    expect(d.summary.steps_total).toBe(4);
    expect(d.report.commands.map((c) => c.command)).toEqual(["pnpm build", "pnpm test"]);
    expect(d.turns.map((t) => t.id)).toEqual(["turn:1"]);
    expect(d.turns[0]!.step_ids).toEqual([]); // a delta does not resend every step id
    // Nothing new since the delta's own as_of.
    const { body: none } = await get<SessionDeltaResponse>(`/api/sessions/${SID}?since=${encodeURIComponent(d.as_of)}`);
    expect(none.steps).toEqual([]);
    // A removed step: the delta cannot express it, so the client reloads.
    await new Promise((r) => setTimeout(r, 5));
    store.ingest(record(first));
    const { body: r } = await get<SessionDeltaResponse>(`/api/sessions/${SID}?since=${encodeURIComponent(d.as_of)}`);
    expect(r.reload).toBe(true);
    expect((await get(`/api/sessions/missing?since=${encodeURIComponent(d.as_of)}`)).status).toBe(404);
  });
});

describe("session list paging and filters", () => {
  it("pages newest first with a cursor, filters, and counts every match", async () => {
    const { PostrunStore: Store } = await import("../store/index.js");
    const { createPostrunServer: create } = await import("./server.js");
    const store = new Store({ path: ":memory:" });
    const base = Date.parse("2026-10-01T00:00:00Z");
    for (let i = 0; i < 12; i++) {
      const at = new Date(base + i * 86400000).toISOString();
      const rec = record(i % 4 === 0 ? [] : [step(`x${i}`, 1, { type: "command", outcome: i % 3 === 0 ? "failed" : "ok", payload: { command: `job ${i}` } })]);
      store.ingest({ ...rec, id: `p-${String(i).padStart(2, "0")}`, started_at: at, workspace: { root: i % 2 ? "/w/alpha" : "/w/beta" },
        steps: rec.steps.map((s) => ({ ...s, session_id: `p-${String(i).padStart(2, "0")}` })), turns: rec.turns.map((t) => ({ ...t, session_id: `p-${String(i).padStart(2, "0")}` })),
        metrics: { ...rec.metrics, cost_usd: 1 } });
    }
    const ui = mkdtempSync(join(tmpdir(), "postrun-ui-"));
    writeFileSync(join(ui, "index.html"), "x");
    const app = create({ port: 0, store, uiDir: ui });
    const { url } = await app.start();
    const get = async (qs: string) => {
      const res = await fetch(new URL(`/api/sessions?${qs}`, url));
      return { status: res.status, body: (await res.json()) as SessionListResponse & { error?: string } };
    };
    const ids: string[] = [];
    let cursor = "";
    for (let n = 0; n < 5; n++) {
      const { body } = await get(`limit=5${cursor ? `&cursor=${cursor}` : ""}`);
      expect(body.total).toBe(12);
      ids.push(...body.sessions.map((s) => s.id));
      if (!body.next_cursor) break;
      cursor = body.next_cursor;
    }
    expect(ids).toEqual([...Array(12).keys()].map((i) => `p-${String(11 - i).padStart(2, "0")}`));
    const nonEmpty = (await get("empty=0")).body;
    expect(nonEmpty.total).toBe(9);
    expect(nonEmpty.empty_count).toBe(3);
    expect(nonEmpty.total_cost).toBe(9);
    expect((await get("failed=1&empty=0")).body.sessions.map((s) => s.id)).toEqual(["p-09", "p-06", "p-03"]);
    expect((await get("from=2026-10-03&to=2026-10-05")).body.sessions.map((s) => s.id)).toEqual(["p-03", "p-02"]);
    expect((await get("q=ALPHA&limit=2")).body.total).toBe(6);
    expect((await get("q=100%25")).body.total).toBe(0);
    expect((await get("min_steps=1")).body.total).toBe(9);
    expect((await get("limit=0")).status).toBe(400);
    expect((await get("from=yesterday-ish")).status).toBe(400);
    expect((await get("cursor=nonsense")).status).toBe(400);
    await app.stop();
    store.close();
  });
});
