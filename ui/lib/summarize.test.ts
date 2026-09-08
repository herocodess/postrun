import { describe, expect, it } from "vitest";
import type { Step } from "@postrun/core/schema";
import { summarize } from "./summarize";

const base = {
  id: "x",
  session_id: "s",
  segment_index: 0,
  turn_id: "turn:1",
  actor_id: "root",
  seq: 1,
  at: "2026-09-04T23:00:00.000Z",
  decision: "n/a" as const,
  outcome: "ok" as const,
  content_status: "inline" as const,
  channels: ["otel"],
  flags: [],
};

describe("summarize", () => {
  it("marks an unjoined command as reference-only with its pointer", () => {
    const step: Step = { ...base, outcome: "failed", content_status: "reference_only", type: "command", payload: { output_ref: "/t.jsonl#tool_use_id=abc" } };
    const s = summarize(step);
    expect(s.referenceOnly).toBe(true);
    expect(s.text).toContain("content not inline");
    expect(s.ref).toBe("/t.jsonl#tool_use_id=abc");
  });

  it("shows the first line of a command and keeps persisted output as a ref", () => {
    const step: Step = { ...base, channels: ["otel", "hook"], type: "command", payload: { command: "ls -la\nsecond", stdout: "x", output_ref: "/persisted.txt" } };
    const s = summarize(step);
    expect(s.referenceOnly).toBe(false);
    expect(s.text).toBe("ls -la …");
    expect(s.ref).toBe("/persisted.txt");
  });

  it("uses content_status for a command whose output was side-channeled (Cline proceed-while-running)", () => {
    const step: Step = {
      ...base,
      content_status: "reference_only",
      type: "command",
      payload: { command: "grep -r foo", output_ref: "/tmp/cline/proceed-while-running-1.log" },
    };
    const s = summarize(step);
    expect(s.referenceOnly).toBe(true);
    expect(s.text).toBe("grep -r foo (output not inline)");
    expect(s.ref).toBe("/tmp/cline/proceed-while-running-1.log");
  });

  it("marks a message without inline text as reference-only", () => {
    const step: Step = { ...base, type: "message", payload: { role: "assistant", text_ref: "/body.json" } };
    expect(summarize(step)).toEqual({ text: "assistant: content not inline", referenceOnly: true, ref: "/body.json" });
  });

  it("summarizes edits and reads by path", () => {
    const edit: Step = { ...base, type: "edit", payload: { path: "/a.ts", old_string: "a", new_string: "b", is_full_write: false } };
    const read: Step = { ...base, type: "read", payload: { path: "/a.ts", range: [1, 50] } };
    expect(summarize(edit).text).toBe("edit /a.ts");
    expect(summarize(read).text).toBe("/a.ts [1-50]");
  });
});
