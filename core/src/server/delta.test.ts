/**
 * Light live views: step previews, one-step fetch, and ?since= deltas. Synthetic.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Step } from "../schema/index.js";
import { PostrunStore, type SessionRecord } from "../store/index.js";
import type { SessionDeltaResponse, SessionDetailResponse, StepResponse } from "./api.js";
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
    expect(d.turns[0]!.step_ids).toEqual(["m1", "c1", "e1", "c2"]);
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
