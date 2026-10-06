import { describe, expect, it } from "vitest";
import type { Step } from "@postrun/core/schema";
import { sessionReport } from "@postrun/core/report";
import type { SessionDetailResponse } from "@postrun/core/server/api";
import { changesByFile, commitsOf, diffLines, plainSummary, prSummary, riskFlagsOf } from "./review";

const ROOT = "/Users/me/app";
let n = 0;
function step(s: Partial<Step> & Pick<Step, "type" | "payload">): Step {
  n++;
  return {
    id: `s${n}`,
    session_id: "sess",
    segment_index: 0,
    turn_id: "turn:1",
    actor_id: "root",
    seq: n,
    at: "2026-10-06T10:00:00.000Z",
    decision: "auto",
    outcome: "ok",
    content_status: "inline",
    channels: ["hook"],
    flags: [],
    ...s,
  } as Step;
}

function detail(steps: Step[], extra: Partial<SessionDetailResponse["summary"]> = {}): SessionDetailResponse {
  return {
    summary: {
      id: "sess",
      agent: { kind: "claude-code", version: "2.1.30" },
      workspace: { root: ROOT },
      owner_id: "local",
      captured_on: "mac",
      source: "test",
      title: "Add retry to the uploader\nmore",
      started_at: "2026-10-06T10:00:00.000Z",
      ended_at: "2026-10-06T10:12:00.000Z",
      ingested_at: "2026-10-06T10:12:00.000Z",
      updated_at: "2026-10-06T10:12:00.000Z",
      steps_total: steps.length,
      step_counts: {},
      strip: "",
      failed_count: 0,
      reference_only_count: 0,
      flag_count: 0,
      turn_count: 1,
      metrics: { cost_usd: 0.42, api_requests: 3, tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 } },
      ...extra,
    },
    segments: [],
    actors: [],
    turns: [],
    steps,
    report: sessionReport(steps),
    as_of: "2026-10-06T10:12:00.000Z",
  } as SessionDetailResponse;
}

describe("commitsOf", () => {
  it("reads branch, sha and message from git commit output, including the first commit", () => {
    const steps = [
      step({ type: "command", payload: { command: "git commit -am 'Retry'", stdout: "[main 1a2b3c4] Retry uploads\n 1 file changed" } }),
      step({ type: "command", payload: { command: "git commit -m init", stdout: "[feat/x (root-commit) 9f8e7d6] Initial commit" } }),
      step({ type: "command", outcome: "failed", payload: { command: "git commit -m nope", stdout: "[main abcdef1] should not count" } }),
      step({ type: "command", payload: { command: "echo '[main 1234567] not a commit'", stdout: "[main 1234567] not a commit" } }),
    ];
    expect(commitsOf(steps)).toEqual([
      { seq: steps[0]!.seq, branch: "main", sha: "1a2b3c4", message: "Retry uploads" },
      { seq: steps[1]!.seq, branch: "feat/x", sha: "9f8e7d6", message: "Initial commit" },
    ]);
  });
});

describe("diffLines", () => {
  it("keeps common lines and marks what was removed and added", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });

  it("treats a new file as all added", () => {
    expect(diffLines("", "x\ny").map((l) => l.kind)).toEqual(["add", "add"]);
  });
});

describe("changesByFile", () => {
  it("groups edits by file with project-relative paths and counts only applied edits", () => {
    const steps = [
      step({ type: "edit", payload: { path: `${ROOT}/src/a.ts`, old_string: "x", new_string: "y\nz", is_full_write: false } }),
      step({ type: "read", payload: { path: `${ROOT}/src/a.ts` } }),
      step({ type: "edit", outcome: "failed", payload: { path: `${ROOT}/src/a.ts`, old_string: "q", new_string: "r", is_full_write: false } }),
      step({ type: "edit", payload: { path: "/tmp/scratch.txt", new_string: "hi", is_full_write: true } }),
    ];
    const files = changesByFile(steps, ROOT);
    expect(files.map((f) => f.rel)).toEqual(["src/a.ts", "/tmp/scratch.txt"]);
    expect(files[0]).toMatchObject({ added: 2, removed: 1 });
    expect(files[0]!.edits.map((e) => e.failed)).toEqual([false, true]);
    expect(files[1]!.edits[0]!.full).toBe(true);
  });
});

describe("plainSummary and prSummary", () => {
  const steps = [
    step({ type: "message", payload: { role: "user", text: "Add retry to the uploader" } }),
    step({ type: "edit", payload: { path: `${ROOT}/src/upload.ts`, old_string: "a", new_string: "b", is_full_write: false } }),
    step({ type: "command", outcome: "failed", payload: { command: "pnpm test", exit_code: 1 } }),
    step({ type: "command", payload: { command: "git push --force origin main" }, flags: [{ kind: "dangerous_command", severity: "danger", reason: "force-pushes" }] }),
    step({ type: "command", payload: { command: "git commit -am x", stdout: "[main 1a2b3c4] Retry uploads" } }),
  ];

  it("says what happened in plain words", () => {
    const s = plainSummary(detail(steps));
    expect(s).toBe("The agent changed 1 file and ran 3 commands in 12 minutes. `pnpm test` failed, and the last command passed. Flagged: risky commands.");
  });

  it("builds pasteable Markdown with changes, commands, commits, risks and the review", () => {
    const md = prSummary(detail(steps, { verdict: { state: "approved", note: "Ship it" }, git_branch: "main" }));
    expect(md).toContain("## Add retry to the uploader\n");
    expect(md).toContain("- `src/upload.ts`");
    expect(md).toContain("- `pnpm test` (failed 1×)");
    expect(md).toContain("- `1a2b3c4` Retry uploads");
    expect(md).toContain("- force-pushes (step 4)");
    expect(md).toContain("Reviewed: looks good. Ship it");
    expect(md).toContain("Claude Code, branch `main`, 5 steps, $0.42");
  });

  it("only lists risk flags, not the adapter's own flags", () => {
    const s = [step({ type: "command", payload: { command: "x" }, flags: [{ kind: "failed", severity: "warn", reason: "failed" }] })];
    expect(riskFlagsOf(s)).toEqual([]);
  });
});
