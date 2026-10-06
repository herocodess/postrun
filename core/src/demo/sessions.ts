/**
 * Example sessions for the public demo (postrun.app/demo) and the example
 * report. Invented but realistic: an "acme-api" project, no real people,
 * paths under ~/code, and AWS keys in the AWS documentation's EXAMPLE format.
 * They go through the real store and exporter, so the demo shows exactly what
 * Postrun produces.
 */

import type { Step } from "../schema/index.js";
import type { SessionRecord } from "../store/index.js";

const ROOT = "~/code/acme-api";

/** Small builder: steps get sequential seq numbers and times relative to the session start. */
function builder(id: string, startIso: string, segment = 0) {
  const t0 = Date.parse(startIso);
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  let seq = 0;
  let turnIndex = 0;
  const steps: Step[] = [];
  const turns: SessionRecord["turns"] = [];
  let turnId = "";
  const base = (s: number, extra: Partial<Step> = {}) =>
    ({
      id: `${id}-s${seq}`,
      session_id: id,
      segment_index: segment,
      turn_id: turnId,
      actor_id: "root",
      seq: seq++,
      at: at(s),
      decision: "accepted",
      outcome: "ok",
      content_status: "inline",
      channels: ["otel", "hook"],
      flags: [],
      ...extra,
    }) as Step;
  return {
    at,
    steps,
    turns,
    turn(s: number, prompt: string) {
      turnIndex++;
      turnId = `${id}-t${turnIndex}`;
      turns.push({ id: turnId, session_id: id, segment_index: segment, actor_id: "root", index: turnIndex, started_at: at(s), step_ids: [] });
      this.msg(s, "user", prompt);
    },
    msg(s: number, role: string, text: string) {
      steps.push({ ...base(s, { decision: "n/a" }), type: "message", payload: { role, text } } as Step);
    },
    read(s: number, path: string, range?: [number, number]) {
      steps.push({ ...base(s), type: "read", payload: { path: `${ROOT}/${path}`, ...(range ? { range } : {}) } } as Step);
    },
    edit(s: number, path: string, oldText: string, newText: string) {
      steps.push({ ...base(s), type: "edit", payload: { path: `${ROOT}/${path}`, old_string: oldText, new_string: newText, is_full_write: false } } as Step);
    },
    write(s: number, path: string, text: string) {
      steps.push({ ...base(s), type: "edit", payload: { path: `${ROOT}/${path}`, new_string: text, is_full_write: true } } as Step);
    },
    cmd(s: number, command: string, stdout = "", exit = 0, stderr = "") {
      const failed = exit !== 0;
      steps.push({
        ...base(s, failed ? { outcome: "failed", error: { type: "ShellError", message: `exit ${exit}` } } : {}),
        type: "command",
        payload: { command, cwd: ROOT, exit_code: exit, ...(stdout ? { stdout } : {}), ...(stderr ? { stderr } : {}) },
      } as Step);
    },
  };
}

function record(
  id: string,
  kind: "claude-code" | "cline",
  version: string,
  b: ReturnType<typeof builder>,
  startIso: string,
  endSec: number,
  metrics: SessionRecord["metrics"],
): SessionRecord {
  return {
    id,
    agent: { kind, version },
    workspace: { root: ROOT, repo: "github.com/acme/acme-api" },
    started_at: startIso,
    ended_at: b.at(endSec),
    segments: [{ index: 0, start_reason: "start", started_at: startIso, ended_at: b.at(endSec), source_files: [] }],
    actors: [{ id: "root", type: "root", label: kind }],
    turns: b.turns,
    steps: b.steps,
    metrics,
    source: "demo",
  };
}

// ---- 1. Claude Code: retry with backoff (the example report) ---------------------
function uploader(): SessionRecord {
  const id = "8f3c2a71-demo-uploader";
  const start = "2026-10-05T14:02:00.000Z";
  const b = builder(id, start);
  b.turn(0, "Uploads to S3 fail intermittently in prod with 503 SlowDown. Add retry with exponential backoff to the uploader, cap it at 5 attempts, and make sure the tests cover it.");
  b.read(4, "src/storage/uploader.ts");
  b.read(6, "src/storage/uploader.test.ts");
  b.cmd(9, 'grep -rn "putObject" src', "src/storage/uploader.ts:41:    await this.s3.putObject(params);\nsrc/jobs/export.ts:88:    await uploader.put(key, body);");
  b.cmd(13, "env | grep -i aws", "AWS_REGION=eu-west-2\nAWS_ACCESS_KEY_ID=AKIA" + "IOSFODNN7EXAMPLE\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
  b.msg(18, "assistant", "The uploader calls putObject once with no retry. I'll add a small withRetry helper with exponential backoff and jitter, retry only on throttling and 5xx errors, and keep the attempt cap configurable.");
  b.write(
    25,
    "src/storage/retry.ts",
    'export interface RetryOptions {\n  attempts?: number;\n  baseMs?: number;\n  maxMs?: number;\n}\n\nconst RETRYABLE = new Set(["SlowDown", "ServiceUnavailable", "InternalError", "RequestTimeout"]);\n\nexport async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {\n  const { attempts = 5, baseMs = 100, maxMs = 3200 } = opts;\n  for (let i = 1; ; i++) {\n    try {\n      return await fn();\n    } catch (err) {\n      const code = (err as { name?: string }).name ?? "";\n      if (i >= attempts || !RETRYABLE.has(code)) throw err;\n      const delay = Math.min(maxMs, baseMs * 2 ** (i - 1));\n      await sleep(delay / 2 + Math.random() * (delay / 2));\n    }\n  }\n}\n\nconst sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));',
  );
  b.edit(31, "src/storage/uploader.ts", "    await this.s3.putObject(params);", "    await withRetry(() => this.s3.putObject(params), { attempts: this.maxAttempts });");
  b.edit(34, "src/storage/uploader.ts", 'import { S3 } from "@aws-sdk/client-s3";', 'import { S3 } from "@aws-sdk/client-s3";\nimport { withRetry } from "./retry";');
  b.edit(
    40,
    "src/storage/uploader.test.ts",
    '  it("uploads the object", async () => {',
    '  it("retries SlowDown and succeeds on the third attempt", async () => {\n    s3.putObject.mockRejectedValueOnce(slowDown()).mockRejectedValueOnce(slowDown()).mockResolvedValueOnce({});\n    await uploader.put("k", body);\n    expect(s3.putObject).toHaveBeenCalledTimes(3);\n  });\n\n  it("uploads the object", async () => {',
  );
  b.cmd(52, "pnpm vitest run src/storage", "", 1, " FAIL  src/storage/uploader.test.ts > retries SlowDown and succeeds on the third attempt\nError: Test timed out in 5000ms.\n\n Test Files  1 failed (1)\n      Tests  1 failed | 6 passed (7)");
  b.msg(60, "assistant", "The retry test times out because the backoff really sleeps. I'll use fake timers in the test rather than shrinking the real delays.");
  b.edit(
    66,
    "src/storage/uploader.test.ts",
    '    await uploader.put("k", body);\n    expect(s3.putObject).toHaveBeenCalledTimes(3);',
    '    vi.useFakeTimers();\n    const done = uploader.put("k", body);\n    await vi.runAllTimersAsync();\n    await done;\n    expect(s3.putObject).toHaveBeenCalledTimes(3);\n    vi.useRealTimers();',
  );
  b.write(
    74,
    "src/storage/retry.test.ts",
    'import { describe, expect, it, vi } from "vitest";\nimport { withRetry } from "./retry";\n\ndescribe("withRetry", () => {\n  it("stops after the attempt cap", async () => {\n    vi.useFakeTimers();\n    const fn = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "SlowDown" }));\n    const p = withRetry(fn, { attempts: 5 }).catch((e) => e);\n    await vi.runAllTimersAsync();\n    expect((await p).name).toBe("SlowDown");\n    expect(fn).toHaveBeenCalledTimes(5);\n  });\n\n  it("does not retry client errors", async () => {\n    const fn = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "AccessDenied" }));\n    await expect(withRetry(fn)).rejects.toThrow();\n    expect(fn).toHaveBeenCalledTimes(1);\n  });\n});',
  );
  b.cmd(88, "pnpm vitest run src/storage", " ✓ src/storage/retry.test.ts  (2 tests) 6ms\n ✓ src/storage/uploader.test.ts  (7 tests) 11ms\n\n Test Files  2 passed (2)\n      Tests  9 passed (9)");
  b.cmd(95, "pnpm tsc --noEmit");
  b.msg(101, "assistant", "Done. Uploads now retry SlowDown, ServiceUnavailable, InternalError and RequestTimeout with exponential backoff and jitter (100 ms doubling to 3.2 s), capped at 5 attempts. Client errors such as AccessDenied fail immediately. Added 3 tests; all 9 storage tests and the typecheck pass.");
  b.turn(140, "Make the attempt cap come from config so ops can tune it without a deploy.");
  b.read(143, "src/config/index.ts");
  b.edit(149, "src/config/index.ts", '  s3Bucket: required("S3_BUCKET"),', '  s3Bucket: required("S3_BUCKET"),\n  s3MaxAttempts: int("S3_MAX_ATTEMPTS", 5),');
  b.edit(153, "src/storage/uploader.ts", "  private readonly maxAttempts = 5;", "  private readonly maxAttempts = config.s3MaxAttempts;");
  b.cmd(160, "pnpm vitest run src/storage src/config", " Test Files  3 passed (3)\n      Tests  12 passed (12)");
  b.msg(166, "assistant", "S3_MAX_ATTEMPTS now sets the cap (default 5). Documented it in .env.example.");
  b.edit(168, ".env.example", "S3_BUCKET=", "S3_BUCKET=\nS3_MAX_ATTEMPTS=5");
  return record(id, "claude-code", "2.1.26", b, start, 172, { cost_usd: 0.87, api_requests: 23, tokens: { input: 184220, output: 9310, cache_read: 151002, cache_creation: 20114 } });
}

// ---- 2. Cline: invoice dates off by one day ----------------------------------------
function invoices(): SessionRecord {
  const id = "1791102233-demo-invoices";
  const start = "2026-10-04T09:41:00.000Z";
  const b = builder(id, start);
  b.turn(0, "Customers in Lagos and New York see invoice due dates one day early. Find out why and fix it.");
  b.cmd(5, 'grep -rn "dueDate" src/billing', "src/billing/invoice.ts:27:  const dueDate = new Date(issued.getTime() + terms * DAY);\nsrc/billing/format.ts:12:  return d.toISOString().slice(0, 10);");
  b.read(9, "src/billing/format.ts");
  b.read(12, "src/billing/invoice.ts", [18, 40]);
  b.msg(19, "assistant", "formatDueDate takes the UTC calendar date, but invoices are issued at local midnight in the customer's timezone. For anyone west or east of UTC the UTC date can land on the previous day. I'll format in the account's timezone instead.");
  b.edit(28, "src/billing/format.ts", "export function formatDueDate(d: Date): string {\n  return d.toISOString().slice(0, 10);\n}", "export function formatDueDate(d: Date, timeZone: string): string {\n  return new Intl.DateTimeFormat(\"en-CA\", { timeZone }).format(d);\n}");
  b.cmd(35, "pnpm tsc --noEmit", "", 2, "src/billing/invoice.ts(44,22): error TS2554: Expected 2 arguments, but got 1.\nsrc/emails/reminder.ts(31,18): error TS2554: Expected 2 arguments, but got 1.");
  b.edit(41, "src/billing/invoice.ts", "    dueDate: formatDueDate(dueDate),", "    dueDate: formatDueDate(dueDate, account.timeZone),");
  b.edit(46, "src/emails/reminder.ts", "  const due = formatDueDate(invoice.dueAt);", "  const due = formatDueDate(invoice.dueAt, invoice.account.timeZone);");
  b.write(
    55,
    "src/billing/format.test.ts",
    'import { describe, expect, it } from "vitest";\nimport { formatDueDate } from "./format";\n\ndescribe("formatDueDate", () => {\n  const lagosMidnight = new Date("2026-11-01T00:00:00+01:00");\n  it("uses the account timezone, not UTC", () => {\n    expect(formatDueDate(lagosMidnight, "Africa/Lagos")).toBe("2026-11-01");\n  });\n  it("handles timezones west of UTC", () => {\n    expect(formatDueDate(new Date("2026-11-01T00:00:00-04:00"), "America/New_York")).toBe("2026-11-01");\n  });\n});',
  );
  b.cmd(63, "pnpm vitest run src/billing src/emails", " ✓ src/billing/format.test.ts  (2 tests) 4ms\n ✓ src/billing/invoice.test.ts  (11 tests) 19ms\n ✓ src/emails/reminder.test.ts  (4 tests) 8ms\n\n Test Files  3 passed (3)\n      Tests  17 passed (17)");
  b.msg(70, "assistant", "Fixed. Due dates are now formatted in the account's timezone everywhere they're shown: the invoice, the PDF and the reminder email. Added two tests for timezones east and west of UTC.");
  return record(id, "cline", "4.1.17", b, start, 74, { cost_usd: 0.31, api_requests: 9, tokens: { input: 61840, output: 3920, cache_read: 40210, cache_creation: 7400 } });
}

// ---- 3. Claude Code: read-only explanation -----------------------------------------
function explain(): SessionRecord {
  const id = "c04be9d2-demo-auth-explain";
  const start = "2026-10-03T16:20:00.000Z";
  const b = builder(id, start);
  b.turn(0, "Explain how a request gets authenticated in this API. Don't change anything.");
  b.cmd(4, "ls src/http/middleware", "auth.ts\ncors.ts\nrate-limit.ts\nrequest-id.ts");
  b.read(7, "src/http/middleware/auth.ts");
  b.read(10, "src/http/server.ts", [1, 60]);
  b.read(14, "src/auth/tokens.ts");
  b.msg(
    24,
    "assistant",
    "Requests pass through four middlewares in order: request-id, cors, rate-limit, then auth. auth.ts reads the Bearer token, verifies it with verifyAccessToken in src/auth/tokens.ts (RS256, 15 minute expiry, issuer checked), and puts the user and scopes on the request. Routes declare required scopes with requireScope(); a missing or expired token is a 401, a missing scope is a 403. Refresh tokens are only accepted on POST /auth/refresh. Nothing was changed.",
  );
  return record(id, "claude-code", "2.1.26", b, start, 27, { cost_usd: 0.09, api_requests: 3, tokens: { input: 22410, output: 1180, cache_read: 9800, cache_creation: 3020 } });
}

export function demoSessions(): SessionRecord[] {
  return [uploader(), invoices(), explain()];
}
