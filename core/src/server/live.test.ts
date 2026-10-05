/**
 * GET /api/events over an on-disk store, so a second connection can play the
 * capture process writing from outside the server. Needs no real captures.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { request, type ClientRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Step } from "../schema/index.js";
import { PostrunStore, type SessionRecord } from "../store/index.js";
import type { LiveChange } from "./api.js";
import { createPostrunServer, type PostrunServer } from "./server.js";
import { generateToken } from "./token.js";

const TOKEN = generateToken();
const T0 = "2026-10-05T22:00:00.000Z";

interface SseEvent {
  event: string;
  data: string;
}

interface Stream {
  status: number;
  events: SseEvent[];
  comments: number;
  ended: boolean;
  waitFor(pred: (e: SseEvent[]) => boolean, ms?: number): Promise<void>;
  close(): void;
}

/** Minimal EventSource for node: parses event/data frames and counts comment lines. */
function openStream(base: string, path: string): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const u = new URL(path, base);
    let req: ClientRequest;
    const s: Stream = {
      status: 0,
      events: [],
      comments: 0,
      ended: false,
      waitFor(pred, ms = 2000) {
        return new Promise((ok, fail) => {
          const started = Date.now();
          const tick = () => {
            if (pred(s.events)) return ok();
            if (Date.now() - started > ms) return fail(new Error(`timed out; got ${JSON.stringify(s.events)}`));
            setTimeout(tick, 10);
          };
          tick();
        });
      },
      close: () => req.destroy(),
    };
    req = request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { accept: "text/event-stream" } }, (res) => {
      s.status = res.statusCode ?? 0;
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let event = "message";
          const data: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith(":")) s.comments++;
            else if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) data.push(line.slice(6));
          }
          if (data.length) s.events.push({ event, data: data.join("\n") });
        }
      });
      res.on("end", () => (s.ended = true));
      res.on("close", () => (s.ended = true));
      resolve(s);
    });
    req.on("error", (err) => (s.status ? undefined : reject(err)));
    req.end();
  });
}

function step(sid: string, seq: number): Step {
  return {
    id: `${sid}-s${seq}`,
    session_id: sid,
    segment_index: 0,
    turn_id: "t0",
    actor_id: "root",
    seq,
    at: T0,
    decision: "accepted",
    outcome: "ok",
    content_status: "inline",
    channels: ["push"],
    flags: [],
    type: "command",
    payload: { command: `echo ${seq}` },
  };
}

function record(sid: string, steps: number): SessionRecord {
  return {
    id: sid,
    agent: { kind: "claude-code", version: "2" },
    workspace: { root: "/repo" },
    started_at: T0,
    segments: [{ index: 0, start_reason: "start", started_at: T0, source_files: [] }],
    actors: [{ id: "root", type: "root" }],
    turns: [{ id: "t0", session_id: sid, segment_index: 0, actor_id: "root", index: 0, started_at: T0, step_ids: [] }],
    steps: Array.from({ length: steps }, (_, i) => step(sid, i)),
    metrics: { cost_usd: 0, api_requests: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 } },
    source: "test",
  };
}

const changes = (s: Stream) => s.events.filter((e) => e.event === "change").map((e) => JSON.parse(e.data) as LiveChange);

describe("GET /api/events", () => {
  const dir = mkdtempSync(join(tmpdir(), "postrun-live-"));
  const dbPath = join(dir, "postrun.db");
  const uiDir = mkdtempSync(join(tmpdir(), "postrun-ui-"));
  writeFileSync(join(uiDir, "index.html"), "<!doctype html>");
  let app: PostrunServer;
  let base: string;
  /** A second connection to the same file: stands in for the capture watcher process. */
  let outside: PostrunStore;

  beforeAll(async () => {
    app = createPostrunServer({ port: 0, dbPath, uiDir, ingestToken: TOKEN, live: { pollMs: 40, heartbeatMs: 100, maxClients: 3 } });
    base = (await app.start()).url;
    outside = new PostrunStore({ path: dbPath });
    outside.ingest(record("before", 1)); // exists before anyone subscribes: not news
  });
  afterAll(async () => {
    outside.close();
    await app.stop();
  });

  it("opens with SSE headers and a ready event, and stops polling when the last client leaves", async () => {
    const s = await openStream(base, "/api/events");
    expect(s.status).toBe(200);
    await s.waitFor((e) => e.some((x) => x.event === "ready"));
    expect(app.live.clientCount).toBe(1);
    s.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(app.live.clientCount).toBe(0);
  });

  it("does not replay changes made before the client connected", async () => {
    const s = await openStream(base, "/api/events");
    await new Promise((r) => setTimeout(r, 150));
    expect(changes(s)).toEqual([]);
    s.close();
  });

  it("reports writes from another process via the poll", async () => {
    const s = await openStream(base, "/api/events");
    await s.waitFor((e) => e.some((x) => x.event === "ready"));
    outside.ingest(record("from-capture", 2));
    await s.waitFor(() => changes(s).some((c) => c.session_id === "from-capture"));
    // A second write to the same session is a second event; a quiet session sends nothing more.
    await new Promise((r) => setTimeout(r, 5));
    outside.ingest(record("from-capture", 3));
    await s.waitFor(() => changes(s).filter((c) => c.session_id === "from-capture").length === 2);
    await new Promise((r) => setTimeout(r, 150));
    expect(changes(s).filter((c) => c.session_id === "from-capture")).toHaveLength(2);
    s.close();
  });

  it("reports pushed batches, and filters by ?session=", async () => {
    const all = await openStream(base, "/api/events");
    const mine = await openStream(base, "/api/events?session=pushed");
    const other = await openStream(base, "/api/events?session=from-capture");
    await Promise.all([all, mine, other].map((s) => s.waitFor((e) => e.some((x) => x.event === "ready"))));

    const r = record("pushed", 1);
    const res = await fetch(new URL("/api/ingest", base), {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ schema_version: "1.2", session: { id: r.id, agent: r.agent, workspace: r.workspace, started_at: r.started_at }, segments: r.segments, actors: r.actors, turns: r.turns, steps: r.steps }),
    });
    expect(res.status).toBe(201);
    await mine.waitFor(() => changes(mine).length === 1);
    await all.waitFor(() => changes(all).some((c) => c.session_id === "pushed"));
    await new Promise((r2) => setTimeout(r2, 120));
    expect(changes(mine).map((c) => c.session_id)).toEqual(["pushed"]);
    expect(changes(other)).toEqual([]);
    for (const s of [all, mine, other]) s.close();
  });

  it("sends heartbeat comments", async () => {
    const s = await openStream(base, "/api/events");
    await new Promise((r) => setTimeout(r, 250));
    expect(s.comments).toBeGreaterThanOrEqual(1);
    s.close();
  });

  it("caps simultaneous streams with 503", async () => {
    await new Promise((r) => setTimeout(r, 50));
    const open = await Promise.all([1, 2, 3].map(() => openStream(base, "/api/events")));
    const extra = await fetch(new URL("/api/events", base));
    expect(extra.status).toBe(503);
    for (const s of open) s.close();
  });

  it("ends open streams when the server stops", async () => {
    const own = createPostrunServer({ port: 0, dbPath, uiDir, ingestToken: TOKEN, live: { pollMs: 40 } });
    const url = (await own.start()).url;
    const s = await openStream(url, "/api/events");
    await s.waitFor((e) => e.some((x) => x.event === "ready"));
    await own.stop();
    await new Promise((r) => setTimeout(r, 30));
    expect(s.ended).toBe(true);
  });
});
