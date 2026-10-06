/**
 * The incremental ingest must store exactly what a full read stores, after
 * every update, for every shape of session. Each scenario writes a session's
 * capture files over simulated time, updates incrementally (with turns
 * lightened once finished), and after every update compares the stored
 * session with a fresh full read of the same files.
 */

import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCodeRecord } from "../store/ingest.js";
import { PostrunStore } from "../store/store.js";
import type { StoredSession } from "../store/types.js";
import { IncrementalSession } from "./incremental.js";

type Line = { t: number; file: "hooks" | "otlp"; text: string };
interface Scenario {
  name: string;
  otel: (turn: number) => boolean; // does telemetry cover this turn?
  otelDelayMs: number; // how late telemetry lands after the event
  toolPromptIds: boolean; // do tool hooks carry prompt_id?
  doubleStop: boolean; // some turns stop twice
  /** Telemetry so late that a turn is already lightened: the watcher's full-read repair must kick in. */
  expectRepairs?: boolean;
}

const SID = "inc-0000-1111";
const T0 = Date.UTC(2026, 9, 6, 9);
const iso = (ms: number) => new Date(ms).toISOString();
const sec = (ms: number) => iso(ms).replace(/\.\d{3}Z$/, "Z");

function generate(s: Scenario, turns: number, seed: number): Line[] {
  let r = seed;
  const rand = () => (r = (r * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const lines: Line[] = [];
  let seq = 0;
  const hook = (t: number, ev: string, x: Record<string, unknown> = {}) =>
    lines.push({ t, file: "hooks", text: JSON.stringify({ received_at: sec(t), channel: "hook", payload: { session_id: SID, hook_event_name: ev, cwd: "/w", transcript_path: "/t.jsonl", ...x } }) });
  const otel = (t: number, name: string, attrs: Record<string, string | number | boolean>) =>
    lines.push({
      t: t + s.otelDelayMs,
      file: "otlp",
      text: JSON.stringify({
        received_at: iso(t + s.otelDelayMs),
        payload: {
          resourceLogs: [
            {
              resource: { attributes: [{ key: "service.version", value: { stringValue: "2.1.30" } }] },
              scopeLogs: [
                {
                  logRecords: [
                    {
                      attributes: [
                        ["event.name", name],
                        ["event.sequence", ++seq],
                        ["event.timestamp", iso(t)],
                        ["session.id", SID],
                        ...Object.entries(attrs),
                      ].map(([key, v]) => ({ key, value: typeof v === "number" ? { intValue: v } : typeof v === "boolean" ? { boolValue: v } : { stringValue: String(v) } })),
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    });
  const big = (n: number) => "output line\n".repeat(n);
  hook(T0, "SessionStart", { source: "startup" });
  for (let turn = 0; turn < turns; turn++) {
    const pid = `p${turn}`;
    const covered = s.otel(turn);
    let t = T0 + 1000 + turn * 60_000;
    hook(t, "UserPromptSubmit", { prompt_id: pid, prompt: `do thing ${turn} ${"x".repeat(300)}` });
    if (covered) otel(t, "user_prompt", { "prompt.id": pid, "message.uuid": `${pid}-u` });
    const tools = 2 + Math.floor(rand() * 4);
    for (let k = 0; k < tools; k++) {
      t += 2000 + Math.floor(rand() * 3000);
      const tid = `${pid}-t${k}`;
      const pidField = s.toolPromptIds ? { prompt_id: pid } : {};
      const kind = rand();
      if (kind < 0.35) {
        hook(t, "PostToolUse", { ...pidField, tool_use_id: tid, tool_name: "Bash", tool_input: { command: `pnpm test ${k}` }, tool_response: { stdout: big(50 + Math.floor(rand() * 400)), stderr: "" } });
      } else if (kind < 0.5) {
        hook(t, "PostToolUseFailure", { ...pidField, tool_use_id: tid, tool_name: "Bash", tool_input: { command: "pnpm build" }, error: "Exit code 2\nbuild failed" });
      } else if (kind < 0.7) {
        hook(t, "PostToolUse", { ...pidField, tool_use_id: tid, tool_name: "Edit", tool_input: { file_path: "/w/a.ts", old_string: big(30), new_string: big(40) }, tool_response: { filePath: "/w/a.ts", structuredPatch: [{ lines: [big(5)] }], originalFile: big(500) } });
      } else if (kind < 0.85) {
        hook(t, "PostToolUse", { ...pidField, tool_use_id: tid, tool_name: "Read", tool_input: { file_path: "/w/b.ts", offset: 10, limit: 40 }, tool_response: { file: { content: big(300) } } });
      } else {
        hook(t, "PostToolUse", { ...pidField, tool_use_id: tid, tool_name: "WebFetch", tool_input: { url: "https://example.com" }, tool_response: { result: big(200) } });
      }
      if (covered) {
        const failed = kind >= 0.35 && kind < 0.5;
        otel(t, "tool_result", { "prompt.id": pid, tool_use_id: tid, tool_name: "Bash", success: failed ? "false" : "true", tool_input: big(20) });
        otel(t, "api_request", { "prompt.id": pid, cost_usd: "0.01", input_tokens: 100, output_tokens: 10 });
      }
    }
    t += 2000;
    const reply = `Turn ${turn} done. ${"y".repeat(250)}`;
    if (covered) otel(t, "assistant_response", { "prompt.id": pid, "message.uuid": `${pid}-a`, query_source: "repl_main_thread", response_length: reply.length });
    if (s.doubleStop && turn % 3 === 0) hook(t, "Stop", { prompt_id: pid, last_assistant_message: "partial" });
    hook(t + 500, "Stop", { prompt_id: pid, last_assistant_message: reply });
  }
  hook(T0 + turns * 60_000 + 5000, "SessionEnd", { reason: "exit" });
  return lines.sort((a, b) => a.t - b.t);
}

/** What a reviewer sees, without bookkeeping timestamps and the source path. */
function comparable(s: StoredSession | undefined) {
  if (!s) return undefined;
  const { updated_at: _u, ingested_at: _i, source: _s, ...summary } = s.summary;
  return { summary, segments: s.segments, actors: s.actors, turns: s.turns, steps: s.steps };
}

const SCENARIOS: Scenario[] = [
  { name: "full telemetry", otel: () => true, otelDelayMs: 1500, toolPromptIds: true, doubleStop: false },
  { name: "hooks only (recorder was down)", otel: () => false, otelDelayMs: 0, toolPromptIds: true, doubleStop: false },
  { name: "telemetry starts part way through", otel: (t) => t >= 4, otelDelayMs: 1500, toolPromptIds: true, doubleStop: false },
  { name: "telemetry lands late", otel: () => true, otelDelayMs: 20_000, toolPromptIds: true, doubleStop: false },
  { name: "tool hooks without prompt ids", otel: () => true, otelDelayMs: 1500, toolPromptIds: false, doubleStop: true },
  { name: "hooks only, no prompt ids, double stops", otel: () => false, otelDelayMs: 0, toolPromptIds: false, doubleStop: true },
  { name: "telemetry minutes late: repaired by a full read", otel: () => true, otelDelayMs: 150_000, toolPromptIds: true, doubleStop: false, expectRepairs: true },
];

describe("incremental Claude Code ingest matches a full read", () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, () => {
      const lines = generate(scenario, 10, 11);
      const dir = join(mkdtempSync(join(tmpdir(), "postrun-inc-")), "sessions", SID);
      mkdirSync(dir, { recursive: true });
      const inc = new IncrementalSession(dir, SID, 30_000);
      const live = new PostrunStore({ path: ":memory:" });
      // Update after every Stop (as the watcher does, 4 s later) and at a few odd moments.
      const stops = lines.filter((l) => l.text.includes('"Stop"') || l.text.includes('"SessionEnd"')).map((l) => l.t + 4000);
      const points = [...new Set([...stops, T0 + 95_000, T0 + 333_000, T0 + 700_000])].sort((a, b) => a - b);
      let written = 0;
      let updates = 0;
      let repairs = 0;
      for (const at of points) {
        const due = lines.filter((l) => l.t <= at && l.t > (updates === 0 ? -Infinity : prevAt));
        for (const l of due) appendFileSync(join(dir, l.file === "hooks" ? "hooks.ndjson" : "otlp-logs.ndjson"), l.text + "\n");
        var prevAt = at; // eslint-disable-line no-var
        if (due.length === 0 && updates > 0) continue;
        const { record, metaOnly } = inc.update(at);
        const res = live.ingest(record, { metaOnly });
        if (res.missing_content) {
          repairs++;
          live.ingest(claudeCodeRecord(dir, SID)); // what the watcher does
        }
        written += res.written;
        updates++;
        const full = new PostrunStore({ path: ":memory:" });
        full.ingest(claudeCodeRecord(dir, SID));
        expect(comparable(live.getSession(SID)), `after update ${updates} at +${(at - T0) / 1000}s`).toEqual(comparable(full.getSession(SID)));
        full.close();
      }
      expect(updates).toBeGreaterThan(10);
      if (scenario.expectRepairs) expect(repairs).toBeGreaterThan(0);
      else expect(repairs).toBe(0);
      // Lightening really happened: the last update kept content only for unfinished turns.
      const last = inc.update(Date.now());
      expect(last.metaOnly.size).toBeGreaterThan(last.record.steps.length / 2);
      expect(written).toBeGreaterThan(0);
      live.close();
    });
  }
});
