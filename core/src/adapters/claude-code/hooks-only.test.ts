/**
 * Sessions the OTel channel did not (fully) see: the receiver was down, or
 * started part way through. hooks.ndjson is written by Claude Code itself, so
 * those sessions must still come out complete, built from the hooks.
 * Synthetic captures, so these run everywhere.
 */

import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeCodeWatcher } from "../../capture/claude-code-watcher.js";
import { validateSteps } from "../../schema/index.js";
import type { Step } from "../../schema/index.js";
import { claudeCodeRecord } from "../../store/ingest.js";
import { PostrunStore } from "../../store/store.js";
import { adaptClaudeCode, readCaptureDir } from "./adapter.js";

const SID = "aaaaaaaa-1111-4222-8333-444444444444";

type Payload = Record<string, unknown>;
const hook = (at: string, hook_event_name: string, extra: Payload = {}, session_id = SID) => ({
  received_at: at,
  channel: "hook",
  payload: { session_id, hook_event_name, cwd: "/work/app", transcript_path: "/t/x.jsonl", ...extra },
});

/** One OTLP logs wrapper line holding the given events. */
const otlp = (events: Array<{ name: string; seq: number; at: string; attrs?: Record<string, string | number | boolean> }>, session_id = SID) => ({
  received_at: "2026-10-06T10:00:00Z",
  payload: {
    resourceLogs: [
      {
        resource: { attributes: [{ key: "service.version", value: { stringValue: "2.1.30" } }] },
        scopeLogs: [
          {
            logRecords: events.map((e) => ({
              attributes: [
                { key: "event.name", value: { stringValue: e.name } },
                { key: "event.sequence", value: { intValue: e.seq } },
                { key: "event.timestamp", value: { stringValue: e.at } },
                { key: "session.id", value: { stringValue: session_id } },
                ...Object.entries(e.attrs ?? {}).map(([key, v]) => ({
                  key,
                  value: typeof v === "number" ? { intValue: v } : typeof v === "boolean" ? { boolValue: v } : { stringValue: v },
                })),
              ],
            })),
          },
        ],
      },
    ],
  },
});

/** Two turns: prompt p1 (a command, a failed command, an edit), then p2 (a read), with Stop replies. */
const HOOKS = [
  hook("2026-10-06T10:00:00Z", "SessionStart", { source: "startup" }),
  hook("2026-10-06T10:00:01Z", "UserPromptSubmit", { prompt_id: "p1", prompt: "fix the upload retry" }),
  hook("2026-10-06T10:00:03Z", "PostToolUse", { prompt_id: "p1", tool_use_id: "t1", tool_name: "Bash", tool_input: { command: "ls src" }, tool_response: { stdout: "upload.ts\n", stderr: "" } }),
  hook("2026-10-06T10:00:04Z", "PostToolUseFailure", { prompt_id: "p1", tool_use_id: "t2", tool_name: "Bash", tool_input: { command: "pnpm test" }, error: "Exit code 1\n2 failed" }),
  hook("2026-10-06T10:00:06Z", "PostToolUse", {
    prompt_id: "p1",
    tool_use_id: "t3",
    tool_name: "Edit",
    tool_input: { file_path: "/work/app/src/upload.ts", old_string: "retry(3)", new_string: "retry(5)" },
    tool_response: { filePath: "/work/app/src/upload.ts" },
  }),
  hook("2026-10-06T10:00:08Z", "Stop", { prompt_id: "p1", last_assistant_message: "Raised the retry cap to 5." }),
  hook("2026-10-06T10:01:00Z", "UserPromptSubmit", { prompt_id: "p2", prompt: "show me the file" }),
  hook("2026-10-06T10:01:02Z", "PostToolUse", { prompt_id: "p2", tool_use_id: "t4", tool_name: "Read", tool_input: { file_path: "/work/app/src/upload.ts" }, tool_response: {} }),
  hook("2026-10-06T10:01:03Z", "Stop", { prompt_id: "p2", last_assistant_message: "first draft" }),
  hook("2026-10-06T10:01:05Z", "Stop", { prompt_id: "p2", last_assistant_message: "Here it is." }),
  hook("2026-10-06T10:01:06Z", "SessionEnd", { reason: "exit" }),
];

/** What OTel would have seen of turn p2 only (the receiver started after p1). */
const OTLP_P2 = otlp([
  { name: "user_prompt", seq: 40, at: "2026-10-06T10:01:00.200Z", attrs: { "prompt.id": "p2", "message.uuid": "u-p2" } },
  { name: "api_request", seq: 41, at: "2026-10-06T10:01:01.000Z", attrs: { "prompt.id": "p2", cost_usd: "0.02", input_tokens: 100, output_tokens: 20 } },
  { name: "tool_result", seq: 42, at: "2026-10-06T10:01:02.500Z", attrs: { "prompt.id": "p2", tool_use_id: "t4", tool_name: "Read", success: "true" } },
  { name: "assistant_response", seq: 43, at: "2026-10-06T10:01:05.100Z", attrs: { "prompt.id": "p2", "message.uuid": "a-p2", query_source: "repl_main_thread", response_length: 11 } },
]);

const kinds = (steps: Step[]) => steps.map((s) => (s.type === "message" ? `${s.payload.role}` : s.type));

describe("claude-code adapter without OTel data", () => {
  const r = adaptClaudeCode({ otlpLogs: [], hooks: HOOKS, sourceFiles: { otlpLogs: "otlp-logs.ndjson", hooks: "hooks.ndjson" } });

  it("builds the whole session from hooks, in order, with valid steps", () => {
    expect(r.session_id).toBe(SID);
    expect(r.stats.capture).toBe("hooks_only");
    expect(kinds(r.steps)).toEqual(["user", "command", "command", "edit", "assistant", "user", "read", "assistant"]);
    expect(r.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.stats.hook_only_steps).toBe(8);
    expect(validateSteps(r.steps).ok).toBe(true);
    for (const s of r.steps) {
      expect(s.channels).toEqual(["hook"]);
      expect(s.decision).toBe(s.type === "message" ? "n/a" : "unknown");
    }
  });

  it("keeps the full content the hooks carry", () => {
    const [user, ls, test, edit, reply] = r.steps;
    expect(user!.type === "message" && user!.payload.text).toBe("fix the upload retry");
    expect(ls!.type === "command" && ls!.payload.stdout).toBe("upload.ts\n");
    expect(test!.outcome).toBe("failed");
    expect(test!.type === "command" && test!.payload.exit_code).toBe(1);
    expect(test!.type === "command" && test!.payload.stderr).toBe("2 failed");
    expect(edit!.type === "edit" && edit!.payload.new_string).toBe("retry(5)");
    expect(reply!.type === "message" && reply!.payload.text).toBe("Raised the retry cap to 5.");
    // A turn that stopped twice keeps only its last reply.
    expect(r.steps[7]!.type === "message" && r.steps[7]!.payload.text).toBe("Here it is.");
  });

  it("groups steps into turns by prompt and spans the session from start to end", () => {
    expect(new Set(r.steps.slice(0, 5).map((s) => s.turn_id))).toEqual(new Set(["turn:p1"]));
    expect(new Set(r.steps.slice(5).map((s) => s.turn_id))).toEqual(new Set(["turn:p2"]));
    expect(r.stats.steps_without_prompt_id).toBe(0);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]!.started_at).toBe("2026-10-06T10:00:00Z");
    expect(r.segments[0]!.ended_at).toBe("2026-10-06T10:01:06Z");
    expect(r.segments[0]!.source_files).toEqual(["hooks.ndjson"]);
    expect(r.stats.totals.cost_usd).toBe(0);
  });

  it("reads a captures directory that has no otlp-logs file at all", () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-hooks-only-"));
    writeFileSync(join(dir, "hooks.ndjson"), HOOKS.map((h) => JSON.stringify(h)).join("\n") + "\n");
    const res = readCaptureDir(dir, SID);
    expect(res.steps).toHaveLength(8);
    expect(res.lines.otlp_logs.total).toBe(0);
  });
});

describe("claude-code adapter when OTel started part way through", () => {
  const r = adaptClaudeCode({ otlpLogs: [OTLP_P2], hooks: HOOKS, sourceFiles: { otlpLogs: "otlp-logs.ndjson", hooks: "hooks.ndjson" } });

  it("fills the turn OTel missed from hooks, keeps OTel's turn, and orders everything by time", () => {
    expect(r.stats.capture).toBe("partial");
    expect(kinds(r.steps)).toEqual(["user", "command", "command", "edit", "assistant", "user", "read", "assistant"]);
    expect(r.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.stats.hook_only_steps).toBe(5); // all of p1
    expect(r.steps.slice(0, 5).every((s) => s.channels.join() === "hook")).toBe(true);
    expect(r.steps.slice(5).every((s) => s.channels.includes("otel"))).toBe(true);
    expect(r.steps.filter((s) => s.id === "t4")).toHaveLength(1); // the read appears once, from OTel
    expect(r.stats.totals.cost_usd).toBeCloseTo(0.02);
    expect(validateSteps(r.steps).ok).toBe(true);
  });
});

describe("claude-code adapter with full OTel coverage", () => {
  it("adds nothing from hooks and keeps OTel's sequence numbers", () => {
    const hooks = HOOKS.filter((h) => (h.payload as Payload)["prompt_id"] !== "p1");
    const r = adaptClaudeCode({ otlpLogs: [OTLP_P2], hooks });
    expect(r.stats.capture).toBe("otel+hooks");
    expect(r.stats.hook_only_steps).toBe(0);
    expect(r.steps.map((s) => s.seq)).toEqual([40, 42, 43]);
  });
});

describe("store and watcher with hooks-only sessions", () => {
  it("replaces hook-based steps when OTel data turns up later, leaving no duplicates", () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-late-otel-"));
    writeFileSync(join(dir, "hooks.ndjson"), HOOKS.map((h) => JSON.stringify(h)).join("\n") + "\n");
    const store = new PostrunStore({ path: ":memory:" });
    store.ingest(claudeCodeRecord(dir, SID));
    expect(store.getSession(SID)!.steps).toHaveLength(8);
    writeFileSync(join(dir, "otlp-logs.ndjson"), JSON.stringify(OTLP_P2) + "\n");
    store.ingest(claudeCodeRecord(dir, SID));
    const steps = store.getSession(SID)!.steps;
    expect(steps).toHaveLength(8);
    expect(steps.filter((s) => s.type === "message" && s.payload.role === "user")).toHaveLength(2);
    expect(steps.some((s) => s.id === "prompt:p2")).toBe(false); // superseded by OTel's u-p2
    store.close();
  });

  it("catches up on start, including sessions that never ended, and records live sessions without OTel", async () => {
    const dir = mkdtempSync(join(tmpdir(), "postrun-catchup-"));
    const open = "bbbbbbbb-1111-4222-8333-444444444444";
    const openHooks = [hook("2026-10-06T11:00:00Z", "UserPromptSubmit", { prompt_id: "q1", prompt: "still going" }, open)];
    writeFileSync(join(dir, "hooks.ndjson"), [...HOOKS, ...openHooks].map((h) => JSON.stringify(h)).join("\n") + "\n");
    const store = new PostrunStore({ path: ":memory:" });
    const logs: string[] = [];
    const w = createClaudeCodeWatcher({ captureDir: dir, store, pollMs: 30, debounceMs: 50, log: (l) => logs.push(l) });
    w.start();
    expect(store.getSession(SID)!.steps).toHaveLength(8);
    expect(store.getSession(SID)!.summary.ended_at).toBe("2026-10-06T10:01:06Z");
    expect(store.getSession(open)!.steps).toHaveLength(1); // no SessionEnd, still caught up
    expect(logs.filter((l) => /recorded from hooks only/.test(l))).toHaveLength(2);

    // Live: the open session carries on and stops; it is updated from hooks alone.
    appendFileSync(join(dir, "hooks.ndjson"), JSON.stringify(hook("2026-10-06T11:00:05Z", "Stop", { prompt_id: "q1", last_assistant_message: "done" }, open)) + "\n");
    await new Promise((res) => setTimeout(res, 300));
    expect(store.getSession(open)!.steps).toHaveLength(2);
    expect(logs.filter((l) => /recorded from hooks only/.test(l))).toHaveLength(2); // reported once per session
    w.stop();

    // A restart does not re-ingest the finished session, only the one still open.
    const logs2: string[] = [];
    const w2 = createClaudeCodeWatcher({ captureDir: dir, store, pollMs: 30, debounceMs: 50, log: (l) => logs2.push(l) });
    w2.start();
    expect(logs2.some((l) => l.includes(`updated ${open}`))).toBe(true);
    expect(logs2.some((l) => l.includes(SID))).toBe(false);
    w2.stop();
    store.close();
  });
});
