/**
 * Capture tests. They never touch ~/.postrun or ~/.cline: everything runs in
 * temp directories seeded with COPIES of the real captures when available.
 */

import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readCaptureDir } from "../adapters/claude-code/index.js";
import { locateClineSession } from "../adapters/cline/index.js";
import { PostrunStore } from "../store/index.js";
import {
  createClaudeCodeWatcher,
  createClineWatcher,
  createOtlpReceiver,
  captureSettings,
  captureEnv,
  configureClaudeCode,
  describeConfigure,
  hookScriptPath,
  isClaudeCodeConfigured,
  isPostrunHook,
  mergeCaptureSettings,
  shellQuote,
  shellUnquote,
  HOOK_EVENTS,
  MAX_BODY_BYTES,
} from "./index.js";

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
  it("binds to 127.0.0.1, splits each logs export by session into its own folder, drops metrics and traces", async () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-cap-"));
    const r = createOtlpReceiver({ captureDir: dir, port: 0 });
    const { url } = await r.start();
    expect(url.startsWith("http://127.0.0.1:")).toBe(true);
    const rec = (sid: string | undefined, n: number) => ({ body: { stringValue: `r${n}` }, attributes: sid === undefined ? [] : [{ key: "session.id", value: { stringValue: sid } }] });
    const resource = { attributes: [{ key: "service.version", value: { stringValue: "2.1.30" } }] };
    const payload = { resourceLogs: [{ resource, scopeLogs: [{ logRecords: [rec("s-1", 1), rec("s-2", 2), rec("s-1", 3), rec(undefined, 4), rec("../x", 5)] }] }] };
    const json = { "content-type": "application/json" };
    expect((await fetch(`${url}/v1/logs`, { method: "POST", headers: json, body: JSON.stringify(payload) })).status).toBe(200);
    expect((await fetch(`${url}/v1/metrics`, { method: "POST", headers: json, body: "{}" })).status).toBe(200);
    expect((await fetch(`${url}/v1/traces`, { method: "POST", headers: json, body: "{}" })).status).toBe(200);
    const bad = await fetch(`${url}/v1/logs`, { method: "POST", headers: { "content-type": "application/x-protobuf" }, body: "x" });
    expect(bad.status).toBe(415);
    expect((await fetch(`${url}/v1/nope`, { method: "POST" })).status).toBe(404);
    await r.stop();
    const read = (sid: string) => readFileSync(join(dir, "sessions", sid, "otlp-logs.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { payload: { resourceLogs: Array<{ resource: unknown; scopeLogs: Array<{ logRecords: unknown[] }> }> } });
    const s1 = read("s-1");
    expect(s1).toHaveLength(1);
    expect(s1[0]!.payload.resourceLogs[0]!.resource).toEqual(resource);
    expect(s1[0]!.payload.resourceLogs[0]!.scopeLogs[0]!.logRecords).toEqual([rec("s-1", 1), rec("s-1", 3)]);
    expect(read("s-2")[0]!.payload.resourceLogs[0]!.scopeLogs[0]!.logRecords).toEqual([rec("s-2", 2)]);
    expect(readdirSync(join(dir, "sessions")).sort()).toEqual(["s-1", "s-2"]); // no folder for a missing or unsafe id
    expect(existsSync(join(dir, "otlp-metrics.ndjson")) || existsSync(join(dir, "otlp-traces.ndjson"))).toBe(false);
    expect(r.counts["/v1/logs"]).toBe(1);
  });

  it("refuses non-loopback Host headers, oversized bodies, and gzip bombs; writes owner-only files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-cap-"));
    const r = createOtlpReceiver({ captureDir: dir, port: 0 });
    const { url } = await r.start();
    const headers = { "content-type": "application/json" };
    // DNS rebinding: a browser reaches 127.0.0.1 but sends the attacker's name as Host. fetch() will not
    // send a custom Host header, so this goes through node:http.
    const rebound = await new Promise<number>((resolve, reject) => {
      const u = new URL(url);
      const req = request({ hostname: u.hostname, port: u.port, path: "/v1/logs", method: "POST", headers: { ...headers, host: "evil.example" } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      });
      req.on("error", reject);
      req.end("{}");
    });
    expect(rebound).toBe(421);
    // Prototype keys are not signals.
    expect((await fetch(`${url}/constructor`, { method: "POST", headers, body: "{}" })).status).toBe(404);
    // Declared oversize is refused before reading.
    const big = await fetch(`${url}/v1/logs`, { method: "POST", headers: { ...headers, "content-length": String(MAX_BODY_BYTES + 1) }, body: "{}" }).catch(() => undefined);
    if (big) expect(big.status).toBe(413);
    // A tiny gzip body that inflates past the limit is rejected, not buffered.
    const bomb = gzipSync(Buffer.alloc(MAX_BODY_BYTES + 1024, 0x20));
    expect(bomb.length).toBeLessThan(100_000);
    const inflated = await fetch(`${url}/v1/logs`, { method: "POST", headers: { ...headers, "content-encoding": "gzip" }, body: bomb });
    expect(inflated.status).toBe(400);
    // Normal export still works and lands in an owner-only file in an owner-only folder.
    const one = { resourceLogs: [{ scopeLogs: [{ logRecords: [{ attributes: [{ key: "session.id", value: { stringValue: "s-9" } }] }] }] }] };
    expect((await fetch(`${url}/v1/logs`, { method: "POST", headers, body: JSON.stringify(one) })).status).toBe(200);
    await r.stop();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "sessions", "s-9")).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "sessions", "s-9", "otlp-logs.ndjson")).mode & 0o777).toBe(0o600);
    expect(r.counts["/v1/logs"]).toBe(1);
  });
});

describe("setup helper", () => {
  it("renders env and hooks pointing at the repo hook script", () => {
    const s = captureSettings("/tmp/cap", 4318) as { env: Record<string, string>; hooks: Record<string, unknown> };
    expect(s.env["OTEL_EXPORTER_OTLP_ENDPOINT"]).toBe("http://127.0.0.1:4318");
    expect(s.env["OTEL_EXPORTER_OTLP_PROTOCOL"]).toBe("http/json");
    expect(Object.keys(s.hooks)).toEqual([...HOOK_EVENTS]);
    expect(hookScriptPath().endsWith("core/scripts/capture-hook.sh")).toBe(true);
    expect(existsSync(hookScriptPath())).toBe(true);
  });

  it("recognises Postrun's own hooks, including the earlier spike script, and nothing else", () => {
    expect(isPostrunHook({ type: "command", command: hookScriptPath() })).toBe(true);
    expect(isPostrunHook({ type: "command", command: "/Users/x/dev/postrun-spike/hooks/capture.sh" })).toBe(true);
    expect(isPostrunHook({ type: "command", command: "/Users/x/bin/capture.sh" })).toBe(false);
    expect(isPostrunHook({ type: "command", command: "/Users/x/postrun/notify.sh" })).toBe(false);
    expect(isPostrunHook({ type: "command", command: "prettier --write" })).toBe(false);
    expect(isPostrunHook("capture-hook.sh")).toBe(false);
  });

  it("shell-quotes hook paths that need it and still recognises them", () => {
    expect(shellQuote("/Users/x/postrun/core/scripts/capture-hook.sh")).toBe("/Users/x/postrun/core/scripts/capture-hook.sh");
    const spaced = "/Users/x/My Code/postrun/core/scripts/capture-hook.sh";
    const quoted = shellQuote(spaced);
    expect(quoted).toBe(`'${spaced}'`);
    expect(shellUnquote(quoted)).toBe(spaced);
    const nasty = "/tmp/it's here; rm -rf ~/postrun/capture-hook.sh";
    expect(shellUnquote(shellQuote(nasty))).toBe(nasty);
    expect(shellQuote(nasty).slice(1, -1)).not.toContain("'; ");
    expect(isPostrunHook({ type: "command", command: quoted }, spaced)).toBe(true);
    const s = captureSettings("/tmp/cap", 4318, spaced) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(s.hooks["Stop"]![0]!.hooks[0]!.command).toBe(quoted);
  });

  it("does not ask Claude Code to dump raw API bodies, and retires that key only when the value is Postrun's", () => {
    expect(Object.keys(captureEnv("/tmp/cap"))).not.toContain("OTEL_LOG_RAW_API_BODIES");
    const ours = mergeCaptureSettings({ env: { OTEL_LOG_RAW_API_BODIES: "file:/Users/x/.postrun/captures/api-bodies" } }, "/tmp/cap");
    expect(ours.report.env_removed).toEqual(["OTEL_LOG_RAW_API_BODIES"]);
    expect((ours.settings["env"] as Record<string, unknown>)["OTEL_LOG_RAW_API_BODIES"]).toBeUndefined();
    const theirs = mergeCaptureSettings({ env: { OTEL_LOG_RAW_API_BODIES: "file:/Users/x/debug/bodies" } }, "/tmp/cap");
    expect(theirs.report.env_removed).toEqual([]);
    expect((theirs.settings["env"] as Record<string, unknown>)["OTEL_LOG_RAW_API_BODIES"]).toBe("file:/Users/x/debug/bodies");
  });

  it("asks for logs only, and retires the metrics and traces exporters only when they pointed at Postrun", () => {
    const env = captureEnv("/tmp/cap");
    expect(env["OTEL_LOGS_EXPORTER"]).toBe("otlp");
    for (const k of ["OTEL_METRICS_EXPORTER", "OTEL_TRACES_EXPORTER", "OTEL_METRIC_EXPORT_INTERVAL", "OTEL_TRACES_EXPORT_INTERVAL"]) expect(Object.keys(env)).not.toContain(k);
    const before = { OTEL_METRICS_EXPORTER: "otlp", OTEL_TRACES_EXPORTER: "otlp", OTEL_METRIC_EXPORT_INTERVAL: "10000", OTEL_TRACES_EXPORT_INTERVAL: "2000" };
    const ours = mergeCaptureSettings({ env: { ...captureEnv("/tmp/cap"), ...before } }, "/tmp/cap");
    expect(ours.report.env_removed.sort()).toEqual(Object.keys(before).sort());
    expect(ours.report.changed).toBe(true);
    // Someone's own OpenTelemetry setup, sending elsewhere: left alone.
    const theirs = mergeCaptureSettings({ env: { ...before, OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com" } }, "/tmp/cap");
    expect(theirs.report.env_removed).toEqual([]);
    expect((theirs.settings["env"] as Record<string, unknown>)["OTEL_METRICS_EXPORTER"]).toBe("otlp");
  });
});

describe("claude code self-configuration", () => {
  // A settings.json with unrelated content of every kind Postrun must not touch:
  // unknown top-level keys, a user env var, a user hook on an event Postrun
  // uses (with a matcher), a user hook on an event Postrun does not use, and
  // a stale spike hook sharing a group with a user hook.
  const userSettings = {
    model: "opus",
    permissions: { allow: ["Bash(git status)"] },
    env: { MY_VAR: "keep-me", OTEL_LOG_USER_PROMPTS: "0" },
    hooks: {
      Notification: [{ hooks: [{ type: "command", command: "/usr/local/bin/notify.sh" }] }],
      PostToolUse: [
        { matcher: "Edit|Write", hooks: [{ type: "command", command: "prettier --write", timeout: 30 }] },
      ],
      Stop: [{ hooks: [{ type: "command", command: "/Users/x/dev/postrun-spike/hooks/capture.sh", timeout: 10 }, { type: "command", command: "say done" }] }],
    },
    tui: { theme: "dark" },
  };

  function tempScript(root: string): string {
    const script = join(root, "capture-hook.sh");
    writeFileSync(script, "#!/bin/sh\nexit 0\n");
    chmodSync(script, 0o644);
    return script;
  }

  it("merges without clobbering, and a second run changes nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "postrun-setup-"));
    const settingsPath = join(root, "settings.json");
    const original = JSON.stringify(userSettings, null, 2) + "\n";
    writeFileSync(settingsPath, original);
    const script = tempScript(root);
    const opts = { captureDir: "/tmp/cap", otlpPort: 4318, settingsPath, script };

    expect(isClaudeCodeConfigured(opts)).toBe(false);
    const r1 = configureClaudeCode(opts);
    expect(r1.created).toBe(false);
    expect(r1.backed_up).toBe(true);
    expect(readFileSync(r1.backup_path, "utf8")).toBe(original);
    expect(r1.hook_script_chmod).toBe(true);
    expect(statSync(script).mode & 0o100).toBe(0o100);
    expect(r1.hooks_added.sort()).toEqual(["PostToolUse", "PostToolUseFailure", "SessionEnd", "SessionStart", "UserPromptSubmit"]);
    expect(r1.hooks_updated).toEqual(["Stop"]);
    expect(r1.env_changed).toEqual([{ key: "OTEL_LOG_USER_PROMPTS", from: "0" }]);
    expect(r1.env_added).toHaveLength(Object.keys(captureEnv("/tmp/cap", 4318)).length - 1);
    expect(describeConfigure(r1)).toMatch(/must be restarted once/);

    const after = JSON.parse(readFileSync(settingsPath, "utf8")) as Omit<typeof userSettings, "env" | "hooks"> & {
      env: Record<string, string>;
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
    };
    // Unknown keys and unrelated settings preserved exactly.
    expect(after.model).toBe("opus");
    expect(after.permissions).toEqual(userSettings.permissions);
    expect(after.tui).toEqual(userSettings.tui);
    expect(after.env.MY_VAR).toBe("keep-me");
    expect(after.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://127.0.0.1:4318");
    expect(after.env.POSTRUN_CAPTURE_DIR).toBe("/tmp/cap");
    // Unrelated hooks preserved: the Notification hook, the prettier group with its matcher, "say done" in the Stop group.
    expect(after.hooks.Notification).toEqual(userSettings.hooks.Notification);
    expect(after.hooks.PostToolUse![0]).toEqual(userSettings.hooks.PostToolUse[0]);
    expect(after.hooks.PostToolUse![1]).toEqual({ hooks: [{ type: "command", command: script, timeout: 10 }] });
    expect(after.hooks.Stop).toEqual([{ hooks: [{ type: "command", command: script, timeout: 10 }, { type: "command", command: "say done" }] }]);
    // Exactly one Postrun hook per event.
    for (const event of HOOK_EVENTS) {
      const mine = after.hooks[event]!.flatMap((g) => g.hooks).filter((h) => isPostrunHook(h, script));
      expect(mine).toHaveLength(1);
      expect(mine[0]!.command).toBe(script);
    }
    expect(isClaudeCodeConfigured(opts)).toBe(true);

    // Second run: idempotent, no new backup, file byte-identical.
    const text1 = readFileSync(settingsPath, "utf8");
    const r2 = configureClaudeCode(opts);
    expect(r2.changed).toBe(false);
    expect(r2.backed_up).toBe(false);
    expect(r2.hook_script_chmod).toBe(false);
    expect(readFileSync(settingsPath, "utf8")).toBe(text1);
    expect(readFileSync(r2.backup_path, "utf8")).toBe(original); // still the true original
    expect(describeConfigure(r2)).toMatch(/already configured, nothing changed/);

    // Pure merge on the result is a no-op too.
    expect(mergeCaptureSettings(JSON.parse(text1) as Record<string, unknown>, "/tmp/cap", 4318, script).report.changed).toBe(false);
  });

  it("creates a minimal file when none exists and refuses to touch invalid JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "postrun-setup-"));
    const script = tempScript(root);
    const settingsPath = join(root, "nested", "settings.json");
    const r = configureClaudeCode({ captureDir: "/tmp/cap", settingsPath, script });
    expect(r.created).toBe(true);
    expect(r.backed_up).toBe(false);
    expect(existsSync(r.backup_path)).toBe(false);
    const doc = JSON.parse(readFileSync(settingsPath, "utf8")) as { env: Record<string, string>; hooks: Record<string, unknown[]> };
    expect(Object.keys(doc).sort()).toEqual(["env", "hooks"]);
    expect(Object.keys(doc.hooks)).toEqual([...HOOK_EVENTS]);
    expect(doc.env.POSTRUN_CAPTURE_DIR).toBe("/tmp/cap");

    const bad = join(root, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(() => configureClaudeCode({ captureDir: "/tmp/cap", settingsPath: bad, script })).toThrow(/not valid JSON/);
    expect(readFileSync(bad, "utf8")).toBe("{ not json");
    expect(existsSync(`${bad}.postrun-backup`)).toBe(false);
    expect(isClaudeCodeConfigured({ captureDir: "/tmp/cap", settingsPath: bad, script })).toBe(false);
  });
});

describe.skipIf(!hasCaptures)("claude-code watcher on a copy of the real capture", () => {
  it("catches up on start, ingests on Stop and SessionEnd idempotently, and keeps hook-only sessions", async () => {
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
    // Startup catches up on every session not yet complete in the store, including the target,
    // which has no SessionEnd in this copy: it is stored open.
    expect(events).toContain(`startup:${target}:true`);
    expect(store.getSession(target)!.summary.ended_at).toBeUndefined();
    // Sessions that have hooks but no OTel data are ingested from the hooks and reported once.
    const hookOnly = logs.filter((l) => /recorded from hooks only/.test(l)).map((l) => l.split(" ")[1]!.replace(/:$/, ""));
    expect(hookOnly.length).toBeGreaterThan(0);

    // A live Stop for the target: re-ingested while the session is still open.
    appendFileSync(join(dir, "hooks.ndjson"), JSON.stringify({ received_at: "2026-09-04T23:30:00Z", channel: "hook", payload: { session_id: target, hook_event_name: "Stop" } }) + "\n");
    await sleep(400);
    expect(events).toContain(`Stop:${target}:false`);
    const c1 = store.counts();
    // The shared files were split into one folder per session on start.
    expect(existsSync(join(dir, "otlp-logs.ndjson"))).toBe(false);
    expect(store.getSession(target)!.steps).toHaveLength(readCaptureDir(join(dir, "sessions", target), target).steps.length);

    // SessionEnd: re-ingest is an update, counts unchanged.
    appendFileSync(join(dir, "hooks.ndjson"), all.find(isEnd)! + "\n");
    await sleep(400);
    expect(events).toContain(`SessionEnd:${target}:false`);
    expect(store.counts()).toEqual(c1);
    expect(w.sessions().get(target)?.ended).toBe(true);

    for (const id of hookOnly) expect(store.getSession(id)!.steps.every((s) => s.channels.join() === "hook")).toBe(true);
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
