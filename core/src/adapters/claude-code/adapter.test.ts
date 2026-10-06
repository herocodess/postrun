/**
 * Tests against the REAL capture files in ~/.postrun/captures.
 * Skipped when the capture directory is absent. Read only.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCaptureDir, readNdjson, flattenOtlpLogs, isHookRecord, parseNdjson, str } from "./index.js";
import type { Step } from "../../schema/index.js";

const CAPTURES = process.env["POSTRUN_CAPTURES"] ?? join(homedir(), ".postrun", "captures");
// The live capture file accumulates sessions; tests pin the original specimen.
const CC_SESSION = process.env["POSTRUN_CC_SESSION"] ?? "3ac04cde-89b6-4e88-941b-72293de124c3";
const hasCaptures = existsSync(join(CAPTURES, "otlp-logs.ndjson")) && existsSync(join(CAPTURES, "hooks.ndjson"));

describe("ndjson parser", () => {
  it("skips malformed lines and counts them", () => {
    const r = parseNdjson('{"a":1}\n{"b":2\n\n{"c":3}\n');
    expect(r.records).toEqual([{ a: 1 }, { c: 3 }]);
    expect(r.skipped).toBe(1);
    expect(r.skipped_lines).toEqual([2]);
    expect(r.total).toBe(3);
  });
});

describe.skipIf(!hasCaptures)("claude-code adapter against real captures", () => {
  const result = hasCaptures ? readCaptureDir(CAPTURES, CC_SESSION) : undefined;
  const steps: Step[] = result?.steps ?? [];

  // Independent read of the hook channel for cross-checking.
  const hooks = hasCaptures
    ? readNdjson(join(CAPTURES, "hooks.ndjson")).records.filter(isHookRecord).filter((h) => h.payload.session_id === result?.session_id)
    : [];
  const hookByToolUseId = new Map(hooks.filter((h) => h.payload.tool_use_id).map((h) => [h.payload.tool_use_id as string, h]));

  // Independent read of the otlp channel, only to collect the strings that must NOT appear in step content.
  const otlpEvents = hasCaptures ? flattenOtlpLogs(readNdjson(join(CAPTURES, "otlp-logs.ndjson")).records) : [];
  const otlpToolInputs = new Set(otlpEvents.map((e) => str(e.attrs, "tool_input")).filter((s): s is string => typeof s === "string"));
  const otlpResponses = new Set(otlpEvents.map((e) => str(e.attrs, "response")).filter((s): s is string => typeof s === "string" && s.length > 0));

  it("surfaces the session cwd and agent version from the capture", () => {
    expect(result!.stats.cwd).toBe("/Users/hero/herodion/dear-ollie");
    expect(result!.stats.agent_version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("produces steps for the one session, ordered by seq", () => {
    expect(steps.length).toBeGreaterThan(0);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.seq).toBeGreaterThan(steps[i - 1]!.seq);
    for (const s of steps) expect(s.session_id).toBe(result!.session_id);
  });

  it("emits every step type the schema defines, and no step lacks a turn", () => {
    const types = new Set(steps.map((s) => s.type));
    expect(types).toContain("command");
    expect(types).toContain("edit");
    expect(types).toContain("read");
    expect(types).toContain("message");
    expect(result!.stats.steps_without_prompt_id).toBe(0);
  });

  it("has at least one command step whose non-empty stdout is byte-identical to the hook record", () => {
    const withStdout = steps.filter(
      (s): s is Extract<Step, { type: "command" }> => s.type === "command" && typeof s.payload.stdout === "string" && s.payload.stdout.length > 0,
    );
    expect(withStdout.length).toBeGreaterThan(0);
    for (const s of withStdout) {
      expect(s.channels).toContain("hook");
      const hook = hookByToolUseId.get(s.id);
      expect(hook).toBeDefined();
      const resp = hook!.payload.tool_response as { stdout?: string };
      expect(s.payload.stdout).toBe(resp.stdout);
    }
  });

  it("never sources content from otlp-logs", () => {
    for (const s of steps) {
      const strings: string[] = [];
      if (s.type === "command") strings.push(s.payload.command ?? "", s.payload.stdout ?? "", s.payload.stderr ?? "");
      if (s.type === "edit") strings.push(s.payload.old_string ?? "", s.payload.new_string ?? "");
      if (s.type === "message") strings.push(s.payload.text ?? "");
      for (const v of strings) {
        if (v.length === 0) continue;
        expect(otlpToolInputs.has(v)).toBe(false);
      }
      // Assistant text exists only when the hook channel evidenced the step.
      if (s.type === "message" && s.payload.role === "assistant" && s.payload.text !== undefined) {
        expect(s.channels).toContain("hook");
      }
      if (s.type === "message" && !s.channels.includes("hook")) {
        expect(s.payload.text).toBeUndefined();
        if (s.payload.role === "assistant") expect(otlpResponses.size).toBeGreaterThan(0); // the content did exist on otlp and was not used
      }
      // Steps not evidenced by the hook carry no inline content at all, only a pointer.
      if (!s.channels.includes("hook")) {
        expect(s.content_status).toBe("reference_only");
        if (s.type === "command") {
          expect(s.payload.command).toBeUndefined();
          expect(s.payload.stdout).toBeUndefined();
          expect(s.payload.output_ref).toBeDefined();
        }
        if (s.type === "edit") {
          expect(s.payload.old_string).toBeUndefined();
          expect(s.payload.new_string).toBeUndefined();
        }
      }
    }
  });

  it("joins otlp tool_results to hook records by tool_use_id and reports the rest", () => {
    const tr = result!.stats.tool_results;
    expect(tr.joined + tr.unjoined.length).toBe(tr.total);
    expect(tr.joined).toBeGreaterThan(0);
    for (const u of tr.unjoined) {
      const step = steps.find((s) => s.id === u.tool_use_id);
      expect(step).toBeDefined();
      expect(step!.channels).toEqual(["otel"]);
      expect(step!.content_status).toBe("reference_only");
    }
  });

  it("edit steps carry full old/new strings from the hook, longer than the truncated otlp tool_input", () => {
    const edits = steps.filter((s): s is Extract<Step, { type: "edit" }> => s.type === "edit" && s.channels.includes("hook"));
    if (edits.length === 0) return;
    let truncatedSeen = 0;
    for (const e of edits) {
      expect(e.payload.path.length).toBeGreaterThan(0);
      expect(e.payload.old_string).toBeDefined();
      expect(e.payload.new_string).toBeDefined();
      expect(e.payload.landed_in_final_state).toBeUndefined();
      const hook = hookByToolUseId.get(e.id)!;
      const input = hook.payload.tool_input as { old_string?: string; new_string?: string };
      expect(e.payload.old_string).toBe(input.old_string);
      expect(e.payload.new_string).toBe(input.new_string);
      const otlp = otlpEvents.find((ev) => ev.name === "tool_result" && str(ev.attrs, "tool_use_id") === e.id);
      const otlpLen = str(otlp?.attrs ?? {}, "tool_input")?.length ?? 0;
      const hookLen = JSON.stringify(hook.payload.tool_input).length;
      if (hookLen > otlpLen) {
        truncatedSeen++;
        expect((e.payload.old_string?.length ?? 0) + (e.payload.new_string?.length ?? 0)).toBeGreaterThan(otlpLen);
      }
    }
    expect(truncatedSeen).toBeGreaterThan(0);
  });

  it("does not drop unmapped tool_results: they become other steps with the hook's full tool_name", () => {
    const others = steps.filter((s): s is Extract<Step, { type: "other" }> => s.type === "other");
    for (const o of others) {
      expect(o.payload.tool_name).not.toBe("mcp_tool"); // placeholder name from otlp-logs is resolved
      expect(o.payload.raw).toBeDefined();
    }
    const otherNames = new Set(others.map((o) => o.payload.tool_name));
    for (const name of Object.keys(result!.stats.other_tool_names)) expect(otherNames).toContain(name);
  });

  it("splits status into decision and outcome, and carries errors for failed steps", () => {
    // OTel-backed steps only: hook-only steps (turns OTel never saw) are covered by hooks-only.test.ts.
    const failed = steps.filter((s) => s.outcome === "failed" && s.channels.includes("otel"));
    const otlpFailed = otlpEvents.filter((e) => e.session_id === result!.session_id && e.name === "tool_result" && str(e.attrs, "success") === "false");
    expect(failed.length).toBe(otlpFailed.length);
    // Every failed step in this capture was accepted (config or user) and then failed.
    for (const s of failed) expect(["auto", "accepted"]).toContain(s.decision);
    for (const s of steps) {
      if (s.type === "message") expect(s.decision).toBe("n/a");
      if (s.outcome === "ok") expect(s.error).toBeUndefined();
    }
    const eisdir = failed.find((s) => s.type === "read" && s.error?.type === "Error:EISDIR");
    expect(eisdir).toBeDefined();
    expect(eisdir!.error!.message).toContain("EISDIR");
  });

  it("marks reference-only content honestly and never emits an empty command string", () => {
    const gitPush = steps.find((s) => s.type === "command" && !s.channels.includes("hook"));
    expect(gitPush).toBeDefined();
    expect(gitPush!.content_status).toBe("reference_only");
    expect(gitPush!.outcome).toBe("failed");
    for (const s of steps) {
      if (s.type === "command") expect(s.payload.command).not.toBe("");
      if (s.type === "message" && s.payload.text === undefined) expect(s.content_status).toBe("reference_only");
      if (s.type === "message" && s.payload.text !== undefined) expect(s.content_status).toBe("inline");
    }
    const referenceOnly = steps.filter((s) => s.content_status === "reference_only");
    expect(referenceOnly.length).toBeGreaterThan(0);
  });

  it("carries the hook's structured patch on edits", () => {
    const edits = steps.filter((s): s is Extract<Step, { type: "edit" }> => s.type === "edit" && s.channels.includes("hook"));
    const withPatch = edits.filter((e) => e.payload.structured_patch !== undefined);
    expect(withPatch.length).toBe(edits.length);
    for (const e of withPatch) {
      const hook = hookByToolUseId.get(e.id)!;
      const resp = hook.payload.tool_response as { structuredPatch?: unknown };
      expect((e.payload.structured_patch as { structuredPatch?: unknown }).structuredPatch).toEqual(resp.structuredPatch);
    }
  });

  it("assigns every step to a segment and reports skipped lines", () => {
    expect(result!.segments.length).toBeGreaterThan(0);
    for (const s of steps) expect(result!.segments.some((seg) => seg.index === s.segment_index)).toBe(true);
    expect(result!.lines.hooks.total).toBeGreaterThan(0);
    expect(result!.lines.otlp_logs.skipped).toBe(0);
  });
});
