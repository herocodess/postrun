import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCaptureDir } from "../adapters/claude-code/index.js";
import { adaptCline, loadClineSession, locateClineSession } from "../adapters/cline/index.js";
import type { Step } from "./index.js";
import { validateActor, validateSegment, validateStep, validateSteps, validateTurn } from "./validate.js";

const base = {
  id: "step-1",
  session_id: "session-1",
  segment_index: 0,
  turn_id: "turn-1",
  actor_id: "root",
  seq: 0,
  at: "2026-09-07T14:00:01.123Z",
  decision: "accepted",
  outcome: "ok",
  content_status: "inline" as const,
  channels: ["hook"],
  flags: [],
};

const valid: Record<Step["type"], Step> = {
  command: { ...base, type: "command", payload: { command: "ls", stdout: "a\n", exit_code: 0, cwd: "/tmp" } },
  edit: { ...base, type: "edit", payload: { path: "a.ts", old_string: "x", new_string: "y", structured_patch: [{ any: "shape" }], is_full_write: false } },
  read: { ...base, type: "read", payload: { path: "a.ts", range: [1, 40] } },
  message: { ...base, type: "message", decision: "n/a", payload: { role: "user", text: "hi" } },
  other: { ...base, type: "other", payload: { tool_name: "mcp__x__y", raw: { nested: { anything: [1, null] } } } },
};

function paths(v: ReturnType<typeof validateStep>): string[] {
  return v.ok ? [] : v.errors.map((e) => e.path);
}

describe("validateStep: accepts", () => {
  for (const [type, step] of Object.entries(valid)) {
    it(`a valid ${type} step`, () => {
      expect(validateStep(step)).toEqual({ ok: true, value: step });
    });
  }

  it("open-enum values outside the known set (escape hatch)", () => {
    const s = { ...valid.command, decision: "deferred", outcome: "timed_out", flags: [{ kind: "new_kind", severity: "warn", reason: "r" }] };
    expect(validateStep(s).ok).toBe(true);
  });

  it("a reference_only step with an error and timezone offset", () => {
    const s = { ...valid.command, content_status: "reference_only", outcome: "failed", at: "2026-09-07T15:00:01+01:00", error: { type: "ShellError", message: "boom" }, payload: { output_ref: "t.jsonl#x" } };
    expect(validateStep(s).ok).toBe(true);
  });
});

describe("validateStep: rejects", () => {
  it("non-objects", () => {
    for (const v of [null, undefined, "x", 1, []]) expect(validateStep(v).ok).toBe(false);
  });

  it("missing required fields, reporting each one", () => {
    const { id: _id, seq: _seq, flags: _flags, ...rest } = valid.command;
    expect(paths(validateStep(rest))).toEqual(expect.arrayContaining(["id", "seq", "flags"]));
  });

  it("unknown fields at step and payload level", () => {
    const s = { ...valid.command, status: "ok", payload: { ...valid.command.payload, exitCode: 0 } };
    expect(paths(validateStep(s))).toEqual(["status", "payload.exitCode"]);
  });

  it("null for optional fields", () => {
    expect(paths(validateStep({ ...valid.command, error: null }))).toEqual(["error"]);
    expect(paths(validateStep({ ...valid.command, payload: { exit_code: null } }))).toEqual(["payload.exit_code"]);
  });

  it("wrong primitive types", () => {
    const s = { ...valid.command, seq: "0", segment_index: 1.5, channels: ["hook", 2], payload: { exit_code: "0" } };
    expect(paths(validateStep(s)).sort()).toEqual(["channels[1]", "payload.exit_code", "segment_index", "seq"]);
  });

  it("negative seq", () => {
    expect(paths(validateStep({ ...valid.command, seq: -1 }))).toEqual(["seq"]);
  });

  it("bad timestamps", () => {
    for (const at of ["2026-09-07", "2026-09-07T14:00:01", "yesterday", "2026-13-45T99:00:00Z"]) {
      expect(paths(validateStep({ ...valid.command, at }))).toEqual(["at"]);
    }
  });

  it("closed enums", () => {
    expect(paths(validateStep({ ...valid.command, content_status: "partial" }))).toEqual(["content_status"]);
    expect(paths(validateStep({ ...valid.command, type: "search" }))).toEqual(["type"]);
    expect(paths(validateStep({ ...valid.command, flags: [{ kind: "x", severity: "critical", reason: "" }] }))).toEqual(["flags[0].severity"]);
  });

  it("payload that does not match its type", () => {
    const s = { ...valid.edit, payload: { command: "ls" } };
    expect(paths(validateStep(s)).sort()).toEqual(["payload.command", "payload.is_full_write", "payload.path"]);
  });

  it("malformed read range", () => {
    for (const range of [[1], [1, 2, 3], ["1", "2"], [1.5, 2]]) {
      expect(paths(validateStep({ ...valid.read, payload: { path: "a", range } }))).toEqual(["payload.range"]);
    }
  });

  it("other.raw that is not an object", () => {
    expect(paths(validateStep({ ...valid.other, payload: { tool_name: "t", raw: [] } }))).toEqual(["payload.raw"]);
  });
});

describe("validateSteps", () => {
  it("prefixes errors with the array index", () => {
    const r = validateSteps([valid.command, { ...valid.read, seq: "x" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual([{ path: "[1].seq", message: 'expected integer, got string "x"' }]);
  });

  it("rejects a non-array", () => {
    expect(validateSteps({}).ok).toBe(false);
  });
});

describe("validateTurn, validateActor, validateSegment", () => {
  it("accept valid values", () => {
    expect(validateTurn({ id: "t", session_id: "s", segment_index: 0, actor_id: "root", index: 0, started_at: "2026-09-07T14:00:00Z", step_ids: ["a"] }).ok).toBe(true);
    expect(validateActor({ id: "root", type: "root", label: "cline" }).ok).toBe(true);
    expect(validateSegment({ index: 0, start_reason: "start", started_at: "2026-09-07T14:00:00Z", source_files: [] }).ok).toBe(true);
  });

  it("reject invalid values", () => {
    expect(validateTurn({ id: "t" }).ok).toBe(false);
    expect(validateActor({ id: "", type: "root" }).ok).toBe(false);
    expect(validateSegment({ index: 0, start_reason: "start", started_at: "2026-09-07T14:00:00Z", ended_at: "later", source_files: [] }).ok).toBe(false);
  });
});

// Real data: every step our own adapters emit must pass. Skipped when the captures are absent.

const CAPTURES = process.env["POSTRUN_CAPTURES"] ?? join(homedir(), ".postrun", "captures");
const CC_SESSION = process.env["POSTRUN_CC_SESSION"] ?? "3ac04cde-89b6-4e88-941b-72293de124c3";
const hasCaptures = existsSync(join(CAPTURES, "otlp-logs.ndjson")) && existsSync(join(CAPTURES, "hooks.ndjson"));

const CLINE_SESSION = process.env["POSTRUN_CLINE_SESSION"] ?? "1788568010939_qp82o";
let hasCline = false;
try {
  hasCline = existsSync(locateClineSession(CLINE_SESSION).messages_path);
} catch {
  hasCline = false;
}

describe.skipIf(!hasCaptures)("claude-code adapter output passes validation", () => {
  it("validates every step and segment", () => {
    const r = readCaptureDir(CAPTURES, CC_SESSION);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(validateSteps(r.steps)).toMatchObject({ ok: true });
    for (const seg of r.segments) expect(validateSegment(seg)).toMatchObject({ ok: true });
  });
});

describe.skipIf(!hasCline)("cline adapter output passes validation", () => {
  it("validates every step, turn, and actor", () => {
    const r = adaptCline(loadClineSession(CLINE_SESSION));
    expect(r.steps.length).toBeGreaterThan(0);
    expect(validateSteps(r.steps)).toMatchObject({ ok: true });
    for (const t of r.turns) expect(validateTurn(t)).toMatchObject({ ok: true });
    for (const a of r.actors) expect(validateActor(a)).toMatchObject({ ok: true });
  });
});
