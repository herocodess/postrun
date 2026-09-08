import { describe, it, expect } from "vitest";
import type { Session, Turn, Step, SessionSegment } from "./index.js";

describe("schema types", () => {
  it("constructs a minimal valid Session with one Turn and one Step", () => {
    // Create a minimal session segment
    const segment: SessionSegment = {
      index: 0,
      start_reason: "start",
      started_at: "2026-09-07T14:00:00Z",
      source_files: ["capture.ndjson"],
    };

    // Create a command step with discriminated union (type narrows payload)
    const step: Step = {
      id: "step-1",
      session_id: "session-1",
      segment_index: 0,
      turn_id: "turn-1",
      actor_id: "actor-root",
      seq: 0,
      at: "2026-09-07T14:00:01Z",
      type: "command",
      decision: "accepted",
      outcome: "ok",
      content_status: "inline",
      channels: ["hook"],
      payload: {
        command: "echo hello",
        stdout: "hello\n",
        exit_code: 0,
        cwd: "/tmp",
      },
      flags: [],
    };

    // Create a turn containing the step
    const turn: Turn = {
      id: "turn-1",
      session_id: "session-1",
      segment_index: 0,
      actor_id: "actor-root",
      index: 0,
      started_at: "2026-09-07T14:00:00Z",
      step_ids: ["step-1"],
    };

    // Create a complete session
    const session: Session = {
      id: "session-1",
      agent: {
        kind: "claude-code",
        version: "1.0.0",
      },
      workspace: {
        root: "/tmp/workspace",
      },
      segments: [segment],
      actors: [
        {
          id: "actor-root",
          type: "root",
        },
      ],
      capture: {
        channels: [
          {
            name: "hook",
            segment_index: 0,
            active_from: "2026-09-07T14:00:00Z",
            active_to: "2026-09-07T14:00:10Z",
            shared_file: false,
          },
        ],
      },
      totals: {
        cost_usd: 0.001,
        tokens: {
          input: 100,
          output: 50,
          cache_read: 0,
          cache_creation: 0,
        },
        step_counts: {
          by_type: {
            command: 1,
          },
        },
        flags: 0,
      },
    };

    // Verify the structure
    expect(session.id).toBe("session-1");
    expect(session.segments).toHaveLength(1);
    expect(session.actors).toHaveLength(1);
    expect(session.totals.cost_usd).toBe(0.001);
    expect(turn.step_ids).toContain("step-1");
    expect(step.type).toBe("command");
    expect(step.decision).toBe("accepted");
    expect(step.outcome).toBe("ok");
    expect(step.content_status).toBe("inline");
    expect(step.error).toBeUndefined();

    // Type narrowing works: step.type === "command" narrows step.payload to CommandPayload
    if (step.type === "command") {
      expect(step.payload.command).toBe("echo hello");
      expect(step.payload.exit_code).toBe(0);
    }
  });

  it("models a reference-only failed step with an error and a structured patch on edits", () => {
    const refOnly: Step = {
      id: "step-2",
      session_id: "session-1",
      segment_index: 0,
      turn_id: "turn-1",
      actor_id: "actor-root",
      seq: 1,
      at: "2026-09-07T14:00:02Z",
      type: "command",
      decision: "auto",
      outcome: "failed",
      content_status: "reference_only",
      error: { type: "ShellError", message: "Shell command failed" },
      channels: ["otel"],
      payload: { output_ref: "/transcript.jsonl#tool_use_id=abc" },
      flags: [],
    };
    expect(refOnly.content_status).toBe("reference_only");
    if (refOnly.type === "command") expect(refOnly.payload.command).toBeUndefined();

    const edit: Step = {
      id: "step-3",
      session_id: "session-1",
      segment_index: 0,
      turn_id: "turn-1",
      actor_id: "actor-root",
      seq: 2,
      at: "2026-09-07T14:00:03Z",
      type: "edit",
      decision: "accepted",
      outcome: "ok",
      content_status: "inline",
      channels: ["otel", "hook"],
      payload: { path: "/a.ts", old_string: "a", new_string: "b", is_full_write: false, structured_patch: { hunks: [] } },
      flags: [],
    };
    if (edit.type === "edit") expect(edit.payload.structured_patch).toEqual({ hunks: [] });
  });
});
