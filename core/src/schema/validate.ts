/**
 * Runtime validation for the v1.2 schema.
 *
 * types.ts is compile-time only; anything arriving over the wire (the ingest
 * endpoint, a third-party adapter, a capture file) is `unknown` until it passes
 * through here. Mirrors types.ts field for field. No dependencies.
 *
 * Rules:
 * - Required fields must be present with the right primitive type.
 * - Open enums (the `(string & {})` escape hatch) accept any non-empty string.
 *   Closed enums (content_status, flag severity, step type) are checked exactly.
 * - Unknown keys are rejected on every object we model, so typos and stale
 *   fields fail loudly instead of being stored. The two deliberately open
 *   shapes, OtherPayload.raw and EditPayload.structured_patch, are not inspected.
 * - Optional fields may be absent but not null. JSON null is not undefined.
 * - Every error is collected with a path, e.g. `steps[3].payload.exit_code`.
 */

import type { Actor, SessionSegment, Step, Turn } from "./types.js";

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: ValidationError[] };

export const EVENT_SCHEMA_VERSION = "1.2";

export const STEP_TYPES = ["command", "edit", "read", "message", "other"] as const;
export const CONTENT_STATUSES = ["inline", "reference_only"] as const;
export const FLAG_SEVERITIES = ["info", "warn", "danger"] as const;

// ISO 8601 date-time with a timezone (Z or ±hh:mm), optional fractional seconds.
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// ---------------------------------------------------------------------------
// Checker: accumulates errors against a path prefix.

type Obj = Record<string, unknown>;

class Checker {
  readonly errors: ValidationError[] = [];

  fail(path: string, message: string): void {
    this.errors.push({ path, message });
  }

  /** Returns the value as an object, or records an error and returns undefined. */
  object(v: unknown, path: string): Obj | undefined {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      this.fail(path, `expected object, got ${describe(v)}`);
      return undefined;
    }
    return v as Obj;
  }

  keys(o: Obj, path: string, allowed: readonly string[]): void {
    for (const k of Object.keys(o)) {
      if (!allowed.includes(k)) this.fail(join(path, k), "unknown field");
    }
  }

  private present(o: Obj, k: string, path: string, optional: boolean): boolean {
    if (!(k in o) || o[k] === undefined) {
      if (!optional) this.fail(join(path, k), "required");
      return false;
    }
    if (o[k] === null) {
      this.fail(join(path, k), optional ? "must be omitted, not null" : "required, got null");
      return false;
    }
    return true;
  }

  string(o: Obj, k: string, path: string, opts: { optional?: boolean; nonEmpty?: boolean } = {}): void {
    if (!this.present(o, k, path, opts.optional ?? false)) return;
    const v = o[k];
    if (typeof v !== "string") return this.fail(join(path, k), `expected string, got ${describe(v)}`);
    if (opts.nonEmpty && v.length === 0) this.fail(join(path, k), "must not be empty");
  }

  boolean(o: Obj, k: string, path: string, opts: { optional?: boolean } = {}): void {
    if (!this.present(o, k, path, opts.optional ?? false)) return;
    if (typeof o[k] !== "boolean") this.fail(join(path, k), `expected boolean, got ${describe(o[k])}`);
  }

  int(o: Obj, k: string, path: string, opts: { optional?: boolean; min?: number } = {}): void {
    if (!this.present(o, k, path, opts.optional ?? false)) return;
    const v = o[k];
    if (typeof v !== "number" || !Number.isInteger(v)) return this.fail(join(path, k), `expected integer, got ${describe(v)}`);
    if (opts.min !== undefined && v < opts.min) this.fail(join(path, k), `must be >= ${opts.min}`);
  }

  timestamp(o: Obj, k: string, path: string, opts: { optional?: boolean } = {}): void {
    if (!this.present(o, k, path, opts.optional ?? false)) return;
    const v = o[k];
    if (typeof v !== "string") return this.fail(join(path, k), `expected ISO 8601 string, got ${describe(v)}`);
    if (!ISO_DATETIME.test(v) || Number.isNaN(Date.parse(v))) this.fail(join(path, k), "expected ISO 8601 date-time with timezone");
  }

  oneOf(o: Obj, k: string, path: string, allowed: readonly string[]): void {
    if (!this.present(o, k, path, false)) return;
    const v = o[k];
    if (typeof v !== "string" || !allowed.includes(v)) {
      this.fail(join(path, k), `expected one of ${allowed.map((a) => `"${a}"`).join(", ")}, got ${describe(v)}`);
    }
  }

  stringArray(o: Obj, k: string, path: string, opts: { optional?: boolean } = {}): void {
    if (!this.present(o, k, path, opts.optional ?? false)) return;
    const v = o[k];
    if (!Array.isArray(v)) return this.fail(join(path, k), `expected array of strings, got ${describe(v)}`);
    v.forEach((item, i) => {
      if (typeof item !== "string") this.fail(`${join(path, k)}[${i}]`, `expected string, got ${describe(item)}`);
    });
  }

  /** Field must be present and an object; returns it for further checks. */
  child(o: Obj, k: string, path: string, opts: { optional?: boolean } = {}): Obj | undefined {
    if (!this.present(o, k, path, opts.optional ?? false)) return undefined;
    return this.object(o[k], join(path, k));
  }
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "string") return v.length > 40 ? `string "${v.slice(0, 40)}..."` : `string "${v}"`;
  if (typeof v === "number") return `number ${v}`;
  return typeof v;
}

function result<T>(c: Checker, v: unknown): ValidationResult<T> {
  return c.errors.length === 0 ? { ok: true, value: v as T } : { ok: false, errors: c.errors };
}

// ---------------------------------------------------------------------------
// Step

const STEP_BASE_KEYS = [
  "id",
  "session_id",
  "segment_index",
  "turn_id",
  "actor_id",
  "seq",
  "at",
  "type",
  "decision",
  "outcome",
  "content_status",
  "error",
  "channels",
  "flags",
  "payload",
] as const;

function checkStep(c: Checker, v: unknown, path: string): void {
  const o = c.object(v, path);
  if (!o) return;
  c.keys(o, path, STEP_BASE_KEYS);

  c.string(o, "id", path, { nonEmpty: true });
  c.string(o, "session_id", path, { nonEmpty: true });
  c.int(o, "segment_index", path, { min: 0 });
  c.string(o, "turn_id", path, { nonEmpty: true });
  c.string(o, "actor_id", path, { nonEmpty: true });
  c.int(o, "seq", path, { min: 0 });
  c.timestamp(o, "at", path);
  c.string(o, "decision", path, { nonEmpty: true }); // open enum
  c.string(o, "outcome", path, { nonEmpty: true }); // open enum
  c.oneOf(o, "content_status", path, CONTENT_STATUSES);
  c.stringArray(o, "channels", path);

  const err = c.child(o, "error", path, { optional: true });
  if (err) {
    const p = join(path, "error");
    c.keys(err, p, ["type", "message"]);
    c.string(err, "type", p, { nonEmpty: true });
    c.string(err, "message", p);
  }

  if ("flags" in o && o["flags"] !== undefined) {
    const flags = o["flags"];
    if (!Array.isArray(flags)) c.fail(join(path, "flags"), `expected array, got ${describe(flags)}`);
    else flags.forEach((f, i) => checkFlag(c, f, `${join(path, "flags")}[${i}]`));
  } else {
    c.fail(join(path, "flags"), "required");
  }

  c.oneOf(o, "type", path, STEP_TYPES);
  const type = o["type"];
  const payload = c.child(o, "payload", path);
  if (!payload || typeof type !== "string" || !(STEP_TYPES as readonly string[]).includes(type)) return;
  checkPayload(c, type as Step["type"], payload, join(path, "payload"));
}

function checkFlag(c: Checker, v: unknown, path: string): void {
  const o = c.object(v, path);
  if (!o) return;
  c.keys(o, path, ["kind", "severity", "reason"]);
  c.string(o, "kind", path, { nonEmpty: true }); // open enum
  c.oneOf(o, "severity", path, FLAG_SEVERITIES);
  c.string(o, "reason", path);
}

function checkPayload(c: Checker, type: Step["type"], o: Obj, path: string): void {
  switch (type) {
    case "command":
      c.keys(o, path, ["command", "stdout", "stderr", "exit_code", "cwd", "output_ref"]);
      c.string(o, "command", path, { optional: true });
      c.string(o, "stdout", path, { optional: true });
      c.string(o, "stderr", path, { optional: true });
      c.int(o, "exit_code", path, { optional: true });
      c.string(o, "cwd", path, { optional: true });
      c.string(o, "output_ref", path, { optional: true });
      return;
    case "edit":
      c.keys(o, path, ["path", "old_string", "new_string", "structured_patch", "is_full_write", "landed_in_final_state"]);
      c.string(o, "path", path, { nonEmpty: true });
      c.string(o, "old_string", path, { optional: true });
      c.string(o, "new_string", path, { optional: true });
      // structured_patch is `unknown` by design: the hook's own diff shape, stored as-is.
      c.boolean(o, "is_full_write", path);
      c.boolean(o, "landed_in_final_state", path, { optional: true });
      return;
    case "read": {
      c.keys(o, path, ["path", "range"]);
      c.string(o, "path", path, { nonEmpty: true });
      if ("range" in o && o["range"] !== undefined) {
        const r = o["range"];
        const ok = Array.isArray(r) && r.length === 2 && r.every((n) => typeof n === "number" && Number.isInteger(n));
        if (!ok) c.fail(join(path, "range"), `expected [start_line, end_line] integers, got ${describe(r)}`);
      }
      return;
    }
    case "message":
      c.keys(o, path, ["role", "text", "text_ref"]);
      c.string(o, "role", path, { nonEmpty: true });
      c.string(o, "text", path, { optional: true });
      c.string(o, "text_ref", path, { optional: true });
      return;
    case "other":
      c.keys(o, path, ["tool_name", "raw"]);
      c.string(o, "tool_name", path, { nonEmpty: true });
      c.child(o, "raw", path); // contents are open by design
      return;
  }
}

// ---------------------------------------------------------------------------
// Turn, Actor, SessionSegment

function checkTurn(c: Checker, v: unknown, path: string): void {
  const o = c.object(v, path);
  if (!o) return;
  c.keys(o, path, ["id", "session_id", "segment_index", "actor_id", "index", "prompt_id", "mode", "started_at", "step_ids"]);
  c.string(o, "id", path, { nonEmpty: true });
  c.string(o, "session_id", path, { nonEmpty: true });
  c.int(o, "segment_index", path, { min: 0 });
  c.string(o, "actor_id", path, { nonEmpty: true });
  c.int(o, "index", path, { min: 0 });
  c.string(o, "prompt_id", path, { optional: true });
  c.string(o, "mode", path, { optional: true });
  c.timestamp(o, "started_at", path);
  c.stringArray(o, "step_ids", path);
}

function checkActor(c: Checker, v: unknown, path: string): void {
  const o = c.object(v, path);
  if (!o) return;
  c.keys(o, path, ["id", "parent_id", "type", "label"]);
  c.string(o, "id", path, { nonEmpty: true });
  c.string(o, "parent_id", path, { optional: true });
  c.string(o, "type", path, { nonEmpty: true }); // open enum
  c.string(o, "label", path, { optional: true });
}

function checkSegment(c: Checker, v: unknown, path: string): void {
  const o = c.object(v, path);
  if (!o) return;
  c.keys(o, path, ["index", "start_reason", "started_at", "ended_at", "source_files"]);
  c.int(o, "index", path, { min: 0 });
  c.string(o, "start_reason", path, { nonEmpty: true });
  c.timestamp(o, "started_at", path);
  c.timestamp(o, "ended_at", path, { optional: true });
  c.stringArray(o, "source_files", path);
}

// ---------------------------------------------------------------------------
// Public API

export function validateStep(v: unknown): ValidationResult<Step> {
  const c = new Checker();
  checkStep(c, v, "");
  return result(c, v);
}

export function validateTurn(v: unknown): ValidationResult<Turn> {
  const c = new Checker();
  checkTurn(c, v, "");
  return result(c, v);
}

export function validateActor(v: unknown): ValidationResult<Actor> {
  const c = new Checker();
  checkActor(c, v, "");
  return result(c, v);
}

export function validateSegment(v: unknown): ValidationResult<SessionSegment> {
  const c = new Checker();
  checkSegment(c, v, "");
  return result(c, v);
}

/** Validates an array of steps; error paths are prefixed `[i]`. */
export function validateSteps(v: unknown): ValidationResult<Step[]> {
  const c = new Checker();
  if (!Array.isArray(v)) {
    c.fail("", `expected array, got ${describe(v)}`);
  } else {
    v.forEach((s, i) => checkStep(c, s, `[${i}]`));
  }
  return result(c, v);
}
