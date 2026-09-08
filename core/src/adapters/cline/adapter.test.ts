/**
 * Tests against the REAL Cline session (memories photo-upload fix) in
 * ~/.cline/data/sessions. Skipped when absent. Read only.
 */

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Step } from "../../schema/index.js";
import { adaptCline, loadClineSession, locateClineSession } from "./index.js";

const SESSION = process.env["POSTRUN_CLINE_SESSION"] ?? "1788568010939_qp82o";
let hasSession = false;
try {
  hasSession = existsSync(locateClineSession(SESSION).messages_path);
} catch {
  hasSession = false;
}

describe.skipIf(!hasSession)("cline adapter against the real session", () => {
  const input = hasSession ? loadClineSession(SESSION) : undefined;
  const result = input ? adaptCline(input) : undefined;
  const steps: Step[] = result?.steps ?? [];

  it("produces steps in a gapless seq order for one session", () => {
    expect(steps.length).toBeGreaterThan(0);
    steps.forEach((s, i) => {
      expect(s.seq).toBe(i);
      expect(s.session_id).toBe(result!.session_id);
      expect(s.channels).toEqual(["conversation"]);
    });
    expect(result!.agent.kind).toBe("cline");
    expect(result!.agent.version).toBe("4.1.17");
  });

  it("emits exactly one root actor (no subagents)", () => {
    expect(result!.actors).toHaveLength(1);
    expect(result!.actors[0]!.type).toBe("root");
    expect(result!.actors[0]!.parent_id).toBeUndefined();
    for (const s of steps) expect(s.actor_id).toBe("root");
  });

  it("has a command step with real inline output", () => {
    const withOutput = steps.filter(
      (s): s is Extract<Step, { type: "command" }> => s.type === "command" && s.content_status === "inline" && typeof s.payload.stdout === "string" && s.payload.stdout.length > 0,
    );
    expect(withOutput.length).toBeGreaterThan(0);
    for (const s of withOutput) {
      expect(s.payload.command).toBeDefined();
      expect(s.payload.command!.length).toBeGreaterThan(0);
      expect(s.payload.stdout!.startsWith("[Command exited")).toBe(false);
    }
  });

  it("marks proceed-while-running commands as reference-only with the log pointer", () => {
    const refOnly = steps.filter((s): s is Extract<Step, { type: "command" }> => s.type === "command" && s.content_status === "reference_only");
    expect(refOnly.length).toBe(result!.stats.proceed_while_running);
    expect(refOnly.length).toBeGreaterThan(0);
    for (const s of refOnly) expect(s.payload.output_ref).toMatch(/proceed-while-running/);
  });

  it("has an edit step with real old and new content, and a create with only new content", () => {
    const edits = steps.filter((s): s is Extract<Step, { type: "edit" }> => s.type === "edit");
    expect(edits.length).toBeGreaterThan(0);
    const replace = edits.find((e) => e.payload.old_string !== undefined);
    expect(replace).toBeDefined();
    expect(replace!.payload.old_string!.length).toBeGreaterThan(0);
    expect(replace!.payload.new_string!.length).toBeGreaterThan(0);
    expect(replace!.payload.is_full_write).toBe(false);
    const create = edits.find((e) => e.payload.old_string === undefined);
    expect(create).toBeDefined();
    expect(create!.payload.is_full_write).toBe(true);
    expect(create!.payload.new_string!.length).toBeGreaterThan(0);
    for (const e of edits) {
      expect(e.payload.path.length).toBeGreaterThan(0);
      expect(e.payload.landed_in_final_state).toBeUndefined();
      expect(e.payload.structured_patch).toBeUndefined();
    }
  });

  it("captures plan/act mode on turns as the agent's own string", () => {
    expect(result!.turns.length).toBeGreaterThan(0);
    const modes = new Set(result!.turns.map((t) => t.mode));
    expect(modes).toContain("act");
    expect(modes).toContain("plan");
    for (const t of result!.turns) {
      expect(t.step_ids.length).toBeGreaterThan(0);
      expect(t.prompt_id).toBeDefined();
    }
    // Every step belongs to a known turn.
    const turnIds = new Set(result!.turns.map((t) => t.id));
    for (const s of steps) expect(turnIds.has(s.turn_id)).toBe(true);
  });

  it("splits decision from outcome and carries errors on failed steps", () => {
    const failed = steps.filter((s) => s.outcome === "failed");
    expect(failed.length).toBeGreaterThan(0);
    for (const s of failed) {
      expect(s.error).toBeDefined();
      expect(s.error!.message.length).toBeGreaterThan(0);
    }
    const exitCoded = failed.filter((s): s is Extract<Step, { type: "command" }> => s.type === "command" && s.payload.exit_code !== undefined);
    expect(exitCoded.length).toBeGreaterThan(0);
    for (const s of steps) {
      if (s.type === "message") expect(s.decision).toBe("n/a");
      else expect(["auto", "accepted"]).toContain(s.decision);
    }
  });

  it("does not drop unmapped tools or unmatched calls", () => {
    expect(result!.stats.tool_uses_without_result).toEqual([]);
    const others = new Set(steps.filter((s) => s.type === "other").map((s) => (s.type === "other" ? s.payload.tool_name : "")));
    expect(others).toContain("search_codebase");
    expect(others).toContain("fetch_web_content");
  });

  it("orders by array index even though ts goes backwards, and assigns every step to a segment", () => {
    expect(result!.stats.backwards_ts).toBeGreaterThan(0);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.seq).toBeGreaterThan(steps[i - 1]!.seq);
    for (const s of steps) expect(result!.segments.some((g) => g.index === s.segment_index)).toBe(true);
    expect(result!.segments.length).toBeGreaterThan(1);
  });
});
