/**
 * POST /api/ingest over an in-memory store. Needs no real captures.
 */

import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Step } from "../schema/index.js";
import { PostrunStore } from "../store/index.js";
import type { IngestErrorResponse, IngestRequest, IngestResponse, SessionDetailResponse } from "./api.js";
import { MAX_BATCH_ITEMS, MAX_INGEST_BYTES } from "./ingest.js";
import { createPostrunServer, type PostrunServer } from "./server.js";
import { bearerMatches, generateToken, loadOrCreateToken } from "./token.js";

const TOKEN = generateToken();
const SID = "push-session-1";
const T0 = "2026-10-05T22:00:00.000Z";

const header = {
  id: SID,
  agent: { kind: "cursor", version: "1.0.0" },
  workspace: { root: "/repo" },
  started_at: T0,
};

function step(seq: number, over: Partial<Step> = {}): Step {
  return {
    id: `step-${seq}`,
    session_id: SID,
    segment_index: 0,
    turn_id: "turn-0",
    actor_id: "root",
    seq,
    at: `2026-10-05T22:00:${String(seq).padStart(2, "0")}.000Z`,
    decision: "accepted",
    outcome: "ok",
    content_status: "inline",
    channels: ["push"],
    flags: [],
    type: "command",
    payload: { command: `echo ${seq}`, exit_code: 0 },
    ...over,
  } as Step;
}

const firstBatch: IngestRequest = {
  schema_version: "1.2",
  session: { ...header, metrics: { cost_usd: 0.25, api_requests: 3, tokens: { input: 100, output: 50, cache_read: 0, cache_creation: 0 } } },
  segments: [{ index: 0, start_reason: "start", started_at: T0, source_files: [] }],
  actors: [{ id: "root", type: "root", label: "cursor" }],
  turns: [{ id: "turn-0", session_id: SID, segment_index: 0, actor_id: "root", index: 0, started_at: T0, step_ids: [] }],
  steps: [
    step(0, { type: "message", decision: "n/a", payload: { role: "user", text: "fix the build" } } as Partial<Step>),
    step(1),
  ],
};

describe("POST /api/ingest", () => {
  let app: PostrunServer;
  let base: string;
  const store = new PostrunStore({ path: ":memory:" });
  const uiDir = mkdtempSync(join(tmpdir(), "postrun-ui-"));
  writeFileSync(join(uiDir, "index.html"), "<!doctype html>");

  const post = (body: unknown, init: { token?: string | null; headers?: Record<string, string>; raw?: Buffer | string } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
    const token = init.token === undefined ? TOKEN : init.token;
    if (token !== null) headers["authorization"] = `Bearer ${token}`;
    return fetch(new URL("/api/ingest", base), { method: "POST", headers, body: init.raw ?? JSON.stringify(body) });
  };
  const session = async () => (await (await fetch(new URL(`/api/sessions/${SID}`, base))).json()) as SessionDetailResponse;

  beforeAll(async () => {
    app = createPostrunServer({ port: 0, store, uiDir, ingestToken: TOKEN });
    base = (await app.start()).url;
  });
  afterAll(async () => {
    await app.stop();
    store.close();
  });

  describe("gatekeeping", () => {
    it("rejects a missing or wrong token with 401 and writes nothing", async () => {
      expect((await post(firstBatch, { token: null })).status).toBe(401);
      const r = await post(firstBatch, { token: generateToken() });
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toContain("Bearer");
      expect(store.counts().sessions).toBe(0);
    });

    it("refuses a cross-site style form post (no token, text/plain)", async () => {
      const r = await post(null, { token: null, headers: { "content-type": "text/plain" }, raw: JSON.stringify(firstBatch) });
      expect(r.status).toBe(401);
    });

    it("answers GET with 405 and never sends CORS headers", async () => {
      const r = await fetch(new URL("/api/ingest", base));
      expect(r.status).toBe(405);
      expect(r.headers.get("allow")).toBe("POST");
      const p = await post(firstBatch, { token: null });
      expect(p.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("still refuses POST on read-only routes", async () => {
      expect((await fetch(new URL("/api/sessions", base), { method: "POST" })).status).toBe(405);
    });

    it("requires application/json and a known encoding (415)", async () => {
      expect((await post(firstBatch, { headers: { "content-type": "text/plain" } })).status).toBe(415);
      expect((await post(firstBatch, { headers: { "content-encoding": "br" } })).status).toBe(415);
    });

    it("rejects bodies over the cap (413), including gzip bombs", async () => {
      const big = Buffer.alloc(MAX_INGEST_BYTES + 1, 0x20);
      expect((await post(null, { raw: big })).status).toBe(413);
      const bomb = gzipSync(Buffer.alloc(MAX_INGEST_BYTES + 1024, 0x20));
      expect(bomb.length).toBeLessThan(MAX_INGEST_BYTES);
      expect((await post(null, { raw: bomb, headers: { "content-encoding": "gzip" } })).status).toBe(413);
    });

    it("rejects too many items in one batch (413)", async () => {
      const steps = Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => step(i));
      const r = await post({ ...firstBatch, steps });
      expect(r.status).toBe(413);
    });

    it("rejects invalid JSON (400)", async () => {
      expect((await post(null, { raw: "{not json" })).status).toBe(400);
    });
  });

  describe("validation", () => {
    const expect400 = async (body: unknown, paths: string[]) => {
      const r = await post(body);
      expect(r.status).toBe(400);
      const e = (await r.json()) as IngestErrorResponse;
      expect(e.details?.map((d) => d.path)).toEqual(paths);
      expect(store.counts().sessions).toBe(0);
    };

    it("requires schema_version 1.2", async () => {
      await expect400({ ...firstBatch, schema_version: "1.1" }, ["schema_version"]);
    });

    it("checks the session header", async () => {
      await expect400({ ...firstBatch, session: { ...header, agent: { kind: "x" }, started_at: "today" } }, ["session.agent.version", "session.started_at"]);
      await expect400({ ...firstBatch, session: { ...header, metrics: { cost_usd: -1, api_requests: 0, tokens: { input: 0, output: 0, cache_read: 0 } } } }, [
        "session.metrics.cost_usd",
        "session.metrics.tokens.cache_creation",
      ]);
    });

    it("reports schema errors with paths into the body", async () => {
      await expect400({ ...firstBatch, steps: [step(0, { payload: { command: "ls", exit_code: "0" } } as unknown as Partial<Step>), { ...step(1), status: "ok" }] }, [
        "steps[0].payload.exit_code",
        "steps[1].status",
      ]);
    });

    it("rejects children that point at unknown or mismatched records", async () => {
      await expect400(
        { ...firstBatch, steps: [step(0, { turn_id: "turn-9" }), step(1, { session_id: "other", actor_id: "ghost", segment_index: 4 })] },
        ["steps[0].turn_id", "steps[1].session_id", "steps[1].segment_index", "steps[1].actor_id"],
      );
    });

    it("rejects duplicate ids and seqs within a batch", async () => {
      await expect400({ ...firstBatch, steps: [step(0), step(0), { ...step(1), seq: 0 }] }, ["steps[1].id", "steps[1].seq", "steps[2].seq"]);
    });
  });

  describe("writes", () => {
    it("creates the session on the first push (201)", async () => {
      const r = await post(firstBatch);
      expect(r.status).toBe(201);
      expect((await r.json()) as IngestResponse).toEqual({ session_id: SID, created: true, steps: 2, turns: 1, segments: 1, actors: 1 });
      const s = await session();
      expect(s.summary.title).toBe("fix the build");
      expect(s.summary.source).toBe("push:cursor");
      expect(s.summary.metrics.cost_usd).toBe(0.25);
      expect(s.turns[0]?.step_ids).toEqual(["step-0", "step-1"]);
    });

    it("appends a steps-only batch that refers to earlier records, keeping metrics (200)", async () => {
      const r = await post({ schema_version: "1.2", session: header, steps: [step(2), step(3, { outcome: "failed", error: { type: "ShellError", message: "exit 1" } })] });
      expect(r.status).toBe(200);
      const s = await session();
      expect(s.steps.map((x) => x.seq)).toEqual([0, 1, 2, 3]);
      expect(s.summary.failed_count).toBe(1);
      expect(s.summary.metrics.cost_usd).toBe(0.25);
      expect(s.summary.ended_at).toBeUndefined();
    });

    it("is idempotent when a batch is re-sent", async () => {
      const r = await post({ schema_version: "1.2", session: header, steps: [step(2), step(3, { outcome: "failed", error: { type: "ShellError", message: "exit 1" } })] });
      expect(r.status).toBe(200);
      expect((await session()).steps).toHaveLength(4);
    });

    it("refuses to reuse a seq for a different step (409)", async () => {
      const r = await post({ schema_version: "1.2", session: header, steps: [step(2, { id: "imposter" })] });
      expect(r.status).toBe(409);
      expect(((await r.json()) as IngestErrorResponse).details?.[0]?.path).toBe("steps[0].seq");
      expect((await session()).steps.find((x) => x.seq === 2)?.id).toBe("step-2");
    });

    it("accepts gzip bodies, closes the session, and updates metrics only when sent", async () => {
      const body = {
        schema_version: "1.2",
        session: { ...header, ended_at: "2026-10-05T22:10:00.000Z", metrics: { cost_usd: 0.4, api_requests: 5, tokens: { input: 200, output: 90, cache_read: 10, cache_creation: 0 } } },
        steps: [step(4)],
      };
      const r = await post(null, { raw: gzipSync(JSON.stringify(body)), headers: { "content-encoding": "gzip" } });
      expect(r.status).toBe(200);
      const after = await post({ schema_version: "1.2", session: header, steps: [step(5)] });
      expect(after.status).toBe(200);
      const s = await session();
      expect(s.summary.ended_at).toBe("2026-10-05T22:10:00.000Z");
      expect(s.summary.metrics.cost_usd).toBe(0.4);
      expect(s.summary.metrics.tokens.cache_read).toBe(10);
      expect(s.steps).toHaveLength(6);
    });

    it("shows pushed sessions in the history list", async () => {
      const list = (await (await fetch(new URL("/api/sessions?agent=cursor", base))).json()) as { sessions: Array<{ id: string; steps_total: number }> };
      expect(list.sessions).toEqual([expect.objectContaining({ id: SID, steps_total: 6 })]);
    });
  });
});

describe("ingest token", () => {
  it("creates an owner-only token once and reuses it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "postrun-tok-")), "nested", "ingest-token");
    const a = loadOrCreateToken(path);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadOrCreateToken(path)).toBe(a);
    expect(readFileSync(path, "utf8").trim()).toBe(a);
  });

  it("refuses a short token on disk", () => {
    const path = join(mkdtempSync(join(tmpdir(), "postrun-tok-")), "ingest-token");
    writeFileSync(path, "short\n");
    expect(() => loadOrCreateToken(path)).toThrow(/shorter than/);
  });

  it("matches only an exact Bearer token", () => {
    const t = generateToken();
    expect(bearerMatches(`Bearer ${t}`, t)).toBe(true);
    expect(bearerMatches(`bearer ${t}`, t)).toBe(true);
    expect(bearerMatches(t, t)).toBe(false);
    expect(bearerMatches(`Bearer ${t}x`, t)).toBe(false);
    expect(bearerMatches(`Basic ${t}`, t)).toBe(false);
    expect(bearerMatches(undefined, t)).toBe(false);
  });
});
