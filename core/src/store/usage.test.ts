/** Local usage counts: counted by day, from a fixed list, never content, never sent. */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Step } from "../schema/index.js";
import { createPostrunServer } from "../server/server.js";
import { PostrunStore } from "./store.js";
import { formatUsage } from "./usage.js";

const META = { version: "0.2.0", platform: "darwin arm64" };
const day = (iso: string) => new Date(iso);

function session(id: string, kind = "claude-code") {
  const at = new Date().toISOString();
  return {
    id,
    agent: { kind, version: "1" },
    workspace: { root: "/Users/someone/secret-project" },
    started_at: at,
    segments: [{ index: 0, start_reason: "startup", started_at: at, source_files: [] }],
    actors: [{ id: "root", type: "root" }],
    turns: [{ id: "turn:1", session_id: id, segment_index: 0, actor_id: "root", index: 1, started_at: at, step_ids: [] }],
    steps: [{ id: "s1", session_id: id, segment_index: 0, turn_id: "turn:1", actor_id: "root", seq: 1, at, type: "message", decision: "n/a", outcome: "ok", content_status: "inline", channels: ["hook"], flags: [], payload: { role: "user", text: "migrate the billing tables" } } as Step],
    metrics: { cost_usd: 0, api_requests: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 } },
    source: "test",
  };
}

describe("usage counts in the store", () => {
  it("counts by day, keeps 30-day and all-time totals, and ignores unknown events", () => {
    const store = new PostrunStore({ path: ":memory:" });
    store.countUsage("app_opened", day("2026-10-01T09:00:00"));
    store.countUsage("app_opened", day("2026-10-01T17:00:00"));
    store.countUsage("app_opened", day("2026-10-05T09:00:00"));
    store.countUsage("pr_summary_copied", day("2026-10-05T09:05:00"));
    store.countUsage("review_marked", day("2026-08-01T09:00:00")); // older than 30 days
    store.countUsage("session text: migrate the billing tables", day("2026-10-05T09:00:00"));
    const u = store.usage(META, day("2026-10-06T12:00:00"));
    expect(u.since).toBe("2026-08-01");
    expect(u.days_active_30).toBe(2);
    expect(u.events.app_opened).toEqual({ total: 3, last_30: 3 });
    expect(u.events.pr_summary_copied).toEqual({ total: 1, last_30: 1 });
    expect(u.events.review_marked).toEqual({ total: 1, last_30: 0 });
    expect(u.daily).toHaveLength(30);
    expect(u.daily.at(-2)).toEqual({ day: "2026-10-05", opened: true, actions: 1 });
    expect(JSON.stringify(u)).not.toContain("billing");
    store.close();
  });

  it("drops days older than about thirteen months as new ones are written", () => {
    const store = new PostrunStore({ path: ":memory:" });
    store.countUsage("search", day("2024-01-01T09:00:00"));
    store.countUsage("search", day("2026-10-06T09:00:00"));
    expect(store.usage(META, day("2026-10-06T12:00:00")).events.search.total).toBe(1);
    store.close();
  });

  it("is cleared by delete everything", () => {
    const store = new PostrunStore({ path: ":memory:" });
    store.countUsage("search");
    store.deleteAll();
    expect(store.usage(META).since).toBeUndefined();
    store.close();
  });

  it("summarises sessions by agent, and the text never carries a session's content", () => {
    const store = new PostrunStore({ path: ":memory:" });
    store.ingest(session("cc-1"));
    store.ingest(session("cl-1", "cline"));
    store.countUsage("report_exported");
    const text = formatUsage(store.usage(META));
    expect(text).toContain("Sessions recorded: 2");
    expect(text).toContain("claude-code 1");
    expect(text).toContain("Exported a report");
    for (const leak of ["cc-1", "cl-1", "secret-project", "billing", "/Users"]) expect(text).not.toContain(leak);
    store.close();
  });
});

describe("usage routes", () => {
  it("counts the page's own events, refuses others, and counts server-side uses as they happen", async () => {
    const store = new PostrunStore({ path: ":memory:" });
    store.ingest(session("cc-1"));
    const ui = mkdtempSync(join(tmpdir(), "postrun-ui-usage-"));
    writeFileSync(join(ui, "index.html"), "x");
    const app = createPostrunServer({ port: 0, store, uiDir: ui, ingestToken: "t".repeat(32), health: { version: "0.2.0" } });
    const { url } = await app.start();
    const post = (event: string) => fetch(new URL("/api/usage", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event }) });
    expect((await post("app_opened")).status).toBe(204);
    expect((await post("pr_summary_copied")).status).toBe(204);
    // Server-side events cannot be inflated from the page, and nothing else can be stored.
    expect((await post("review_marked")).status).toBe(400);
    expect((await post("anything at all")).status).toBe(400);
    expect((await fetch(new URL("/api/usage", url), { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: '{"event":"app_opened"}' })).status).toBe(403);

    await fetch(new URL("/api/sessions?q=billing", url));
    await fetch(new URL("/api/sessions/cc-1/export", url));
    await fetch(new URL("/api/sessions/cc-1/verdict", url), { method: "PUT", headers: { "content-type": "application/json" }, body: '{"state":"approved"}' });

    const u = (await (await fetch(new URL("/api/usage", url))).json()) as { events: Record<string, { total: number }>; text: string; version: string };
    expect(u.events["app_opened"]!.total).toBe(1);
    expect(u.events["pr_summary_copied"]!.total).toBe(1);
    expect(u.events["search"]!.total).toBe(1);
    expect(u.events["report_exported"]!.total).toBe(1);
    expect(u.events["review_marked"]!.total).toBe(1);
    expect(u.version).toBe("0.2.0");
    expect(u.text).not.toContain("billing");
    await app.stop();
    store.close();
  });
});
