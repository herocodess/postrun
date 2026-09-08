/**
 * Capture tests. They never touch ~/.postrun or ~/.cline: everything runs in
 * temp directories seeded with COPIES of the real captures when available.
 */

import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locateClineSession } from "../adapters/cline/index.js";
import { PostrunStore } from "../store/index.js";
import { createClaudeCodeWatcher, createClineWatcher, createOtlpReceiver, captureSettings, hookScriptPath } from "./index.js";

const CAPTURES = process.env["POSTRUN_CAPTURES"] ?? join(homedir(), ".postrun", "captures");
const hasCaptures = existsSync(join(CAPTURES, "otlp-logs.ndjson")) && existsSync(join(CAPTURES, "hooks.ndjson"));
const CLINE = process.env["POSTRUN_CLINE_SESSION"] ?? "1788568010939_qp82o";
let clineFiles: ReturnType<typeof locateClineSession> | undefined;
try {
  clineFiles = locateClineSession(CLINE);
} catch {
  clineFiles = undefined;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("otlp receiver", () => {
  it("binds to 127.0.0.1, appends one NDJSON line per export, rejects non-json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-cap-"));
    const r = createOtlpReceiver({ captureDir: dir, port: 0 });
    const { url } = await r.start();
    expect(url.startsWith("http://127.0.0.1:")).toBe(true);
    const payload = { resourceLogs: [{ scopeLogs: [{ logRecords: [{ body: { stringValue: "x" }, attributes: [] }] }] }] };
    const ok = await fetch(`${url}/v1/logs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    expect(ok.status).toBe(200);
    const bad = await fetch(`${url}/v1/logs`, { method: "POST", headers: { "content-type": "application/x-protobuf" }, body: "x" });
    expect(bad.status).toBe(415);
    expect((await fetch(`${url}/v1/nope`, { method: "POST" })).status).toBe(404);
    await r.stop();
    const lines = readFileSync(join(dir, "otlp-logs.ndjson"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as { received_at: string; payload: unknown };
    expect(parsed.payload).toEqual(payload);
    expect(r.counts["/v1/logs"]).toBe(1);
  });
});

describe("setup helper", () => {
  it("renders env and hooks pointing at the repo hook script", () => {
    const s = captureSettings("/tmp/cap", 4318) as { env: Record<string, string>; hooks: Record<string, unknown> };
    expect(s.env["OTEL_EXPORTER_OTLP_ENDPOINT"]).toBe("http://127.0.0.1:4318");
    expect(s.env["OTEL_EXPORTER_OTLP_PROTOCOL"]).toBe("http/json");
    expect(Object.keys(s.hooks)).toEqual(["SessionStart", "UserPromptSubmit", "PostToolUse", "PostToolUseFailure", "Stop", "SessionEnd"]);
    expect(hookScriptPath().endsWith("core/scripts/capture-hook.sh")).toBe(true);
    expect(existsSync(hookScriptPath())).toBe(true);
  });
});

describe.skipIf(!hasCaptures)("claude-code watcher on a copy of the real capture", () => {
  it("ingests on Stop and SessionEnd, idempotently, and skips hook-only sessions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-cc-"));
    copyFileSync(join(CAPTURES, "otlp-logs.ndjson"), join(dir, "otlp-logs.ndjson"));
    // Start with the real hooks lines EXCEPT the target session's SessionEnd, appended later to simulate live end.
    const target = "3ac04cde-89b6-4e88-941b-72293de124c3";
    const all = readFileSync(join(CAPTURES, "hooks.ndjson"), "utf8").split("\n").filter(Boolean);
    const isEnd = (l: string) => l.includes(`"session_id":"${target}"`) && l.includes('"hook_event_name":"SessionEnd"');
    writeFileSync(join(dir, "hooks.ndjson"), all.filter((l) => !isEnd(l)).join("\n") + "\n");

    const store = new PostrunStore({ path: ":memory:" });
    const events: string[] = [];
    const logs: string[] = [];
    const w = createClaudeCodeWatcher({ captureDir: dir, store, pollMs: 50, debounceMs: 100, log: (l) => logs.push(l), onIngest: (r, t) => events.push(`${t}:${r.session_id}:${r.created}`) });
    w.start();
    // Startup ingests only sessions with a SessionEnd; the target has none yet (in this copy).
    expect(store.getSession(target)).toBeUndefined();
    // Sessions that have hooks but no OTel data are reported once and never ingested.
    const hookOnly = logs.filter((l) => /hooks only, no OTel data/.test(l)).map((l) => l.split(" ")[1]!.replace(/:$/, ""));
    expect(hookOnly.length).toBeGreaterThan(0);

    // A live Stop for the target: ingested while the session is still open.
    appendFileSync(join(dir, "hooks.ndjson"), JSON.stringify({ received_at: "2026-09-04T23:30:00Z", channel: "hook", payload: { session_id: target, hook_event_name: "Stop" } }) + "\n");
    await sleep(400);
    expect(events).toContain(`Stop:${target}:true`);
    const c1 = store.counts();
    expect(store.getSession(target)!.steps).toHaveLength(100);

    // SessionEnd: re-ingest is an update, counts unchanged.
    appendFileSync(join(dir, "hooks.ndjson"), all.find(isEnd)! + "\n");
    await sleep(400);
    expect(events).toContain(`SessionEnd:${target}:false`);
    expect(store.counts()).toEqual(c1);
    expect(w.sessions().get(target)?.ended).toBe(true);

    for (const id of hookOnly) expect(store.getSession(id)).toBeUndefined();
    w.stop();
    store.close();
  });
});

describe.skipIf(!clineFiles)("cline watcher on a copy of the real session", () => {
  it("ingests on startup, re-ingests on change without duplicating, tolerates half-written json", async () => {
    const root = mkdtempSync(join(tmpdir(), "postrun-cline-"));
    const id = clineFiles!.session_id;
    mkdirSync(join(root, id));
    copyFileSync(clineFiles!.messages_path, join(root, id, `${id}.messages.json`));
    if (clineFiles!.meta_path) copyFileSync(clineFiles!.meta_path, join(root, id, `${id}.json`));

    const store = new PostrunStore({ path: ":memory:" });
    const events: string[] = [];
    const logs: string[] = [];
    const w = createClineWatcher({ sessionsDir: root, store, debounceMs: 100, pollMs: 100, log: (l) => logs.push(l), onIngest: (r, t) => events.push(`${t}:${r.created}`) });
    w.start();
    expect(events).toEqual(["startup:true"]);
    const c1 = store.counts();
    expect(c1.sessions).toBe(1);

    // Simulate Cline appending a message: rewrite the file with one more user message.
    const doc = JSON.parse(readFileSync(join(root, id, `${id}.messages.json`), "utf8")) as { messages: Array<Record<string, unknown>> };
    doc.messages.push({ id: "msg_live_1", role: "user", content: [{ type: "text", text: '<user_input mode="act">one more thing</user_input>' }], ts: Date.now() });
    await sleep(20);
    writeFileSync(join(root, id, `${id}.messages.json`), JSON.stringify(doc));
    await sleep(600);
    expect(events.filter((e) => e.endsWith(":false")).length).toBeGreaterThan(0);
    const c2 = store.counts();
    expect(c2.sessions).toBe(1);
    expect(c2.steps).toBe(c1.steps + 1);
    expect(c2.turns).toBe(c1.turns + 1);

    // Half-written file: no crash, logged, counts unchanged.
    await sleep(20);
    writeFileSync(join(root, id, `${id}.messages.json`), JSON.stringify(doc).slice(0, 5000));
    await sleep(600);
    expect(logs.some((l) => /not parseable yet/.test(l))).toBe(true);
    expect(store.counts()).toEqual(c2);

    // A brand-new session directory appears.
    const id2 = "1799999999999_test0";
    mkdirSync(join(root, id2));
    await sleep(20);
    writeFileSync(join(root, id2, `${id2}.messages.json`), JSON.stringify({ version: 1, sessionId: id2, origin: { version: "4.1.17" }, messages: doc.messages.slice(0, 3) }));
    await sleep(600);
    expect(store.counts().sessions).toBe(2);
    w.stop();
    store.close();
  });
});
