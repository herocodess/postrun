/**
 * POST /api/ingest: checks a pushed batch before anything is written.
 *
 * Three layers, in order, all of which must pass:
 *   1. Envelope: schema_version is "1.2", the session header is well formed,
 *      and the batch is within the per-batch limits.
 *   2. Schema: every segment, actor, turn, and step passes the v1.2 runtime
 *      validator.
 *   3. References: children belong to this session, and every segment index,
 *      actor id, and turn id a child points at exists in this batch or in the
 *      store already. Steps keep seq unique per session: reusing a seq for a
 *      different step id is a conflict (409), re-sending the same step is an
 *      idempotent update.
 *
 * Pure apart from reading SessionRefs from the store; the caller writes.
 */

import {
  EVENT_SCHEMA_VERSION,
  validateActor,
  validateSegment,
  validateStep,
  validateTurn,
  type ValidationError,
  type ValidationResult,
} from "../schema/index.js";
import type { Actor, SessionSegment, Step, Turn } from "../schema/index.js";
import type { PostrunStore, SessionBatch, SessionHeader, SessionRefs } from "../store/index.js";

/** Largest request body accepted, before and after gzip. */
export const MAX_INGEST_BYTES = 8 * 1024 * 1024;
/** Most children of each kind in one batch. Bigger sessions push in several batches. */
export const MAX_BATCH_ITEMS = 5000;
/** Most validation errors returned in one response; the rest are counted. */
export const MAX_REPORTED_ERRORS = 100;

export type IngestCheck =
  | { ok: true; batch: SessionBatch }
  | { ok: false; status: 400 | 409 | 413; error: string; details?: ValidationError[]; omitted?: number };

const TOP_KEYS = ["schema_version", "session", "segments", "actors", "turns", "steps"];
const HEADER_KEYS = ["id", "agent", "workspace", "started_at", "ended_at", "source", "metrics"];
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function checkIngest(body: unknown, store: Pick<PostrunStore, "sessionRefs">): IngestCheck {
  const errors: ValidationError[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });

  // ---- 1. envelope ---------------------------------------------------------
  if (!isObj(body)) return reject(400, "body must be a JSON object", [{ path: "", message: `got ${kind(body)}` }]);
  for (const k of Object.keys(body)) if (!TOP_KEYS.includes(k)) fail(k, "unknown field");
  if (body["schema_version"] !== EVENT_SCHEMA_VERSION) {
    fail("schema_version", `must be "${EVENT_SCHEMA_VERSION}", got ${kind(body["schema_version"])}`);
  }

  const header = checkHeader(body["session"], fail);
  const lists: Record<"segments" | "actors" | "turns" | "steps", unknown[]> = { segments: [], actors: [], turns: [], steps: [] };
  for (const key of Object.keys(lists) as Array<keyof typeof lists>) {
    const v = body[key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) {
      fail(key, `expected array, got ${kind(v)}`);
      continue;
    }
    if (v.length > MAX_BATCH_ITEMS) {
      return reject(413, `too many ${key} in one batch: ${v.length} > ${MAX_BATCH_ITEMS}; split it into several pushes`);
    }
    lists[key] = v;
  }
  if (errors.length) return reject(400, "invalid batch", errors);

  // ---- 2. schema -----------------------------------------------------------
  const collect = <T>(key: string, items: unknown[], validate: (v: unknown) => ValidationResult<T>): T[] => {
    const out: T[] = [];
    items.forEach((item, i) => {
      const r = validate(item);
      if (r.ok) out.push(r.value);
      else for (const e of r.errors) fail(e.path ? `${key}[${i}].${e.path}` : `${key}[${i}]`, e.message);
    });
    return out;
  };
  const segments = collect<SessionSegment>("segments", lists.segments, validateSegment);
  const actors = collect<Actor>("actors", lists.actors, validateActor);
  const turns = collect<Turn>("turns", lists.turns, validateTurn);
  const steps = collect<Step>("steps", lists.steps, validateStep);
  if (errors.length || !header) return reject(400, "invalid batch", errors);

  // ---- 3. references -------------------------------------------------------
  const sid = header.id;
  const refs: SessionRefs = store.sessionRefs(sid);
  const segIdx = new Set(refs.segments);
  const actorIds = new Set(refs.actors);
  const turnIds = new Set(refs.turns);

  dupes(segments.map((g) => g.index), "segments", "index", fail);
  dupes(actors.map((a) => a.id), "actors", "id", fail);
  dupes(turns.map((t) => t.id), "turns", "id", fail);
  dupes(steps.map((s) => s.id), "steps", "id", fail);
  dupes(steps.map((s) => s.seq), "steps", "seq", fail);
  for (const g of segments) segIdx.add(g.index);
  for (const a of actors) actorIds.add(a.id);
  for (const t of turns) turnIds.add(t.id);

  actors.forEach((a, i) => {
    if (a.parent_id !== undefined && !actorIds.has(a.parent_id)) fail(`actors[${i}].parent_id`, `unknown actor "${a.parent_id}"`);
  });
  turns.forEach((t, i) => {
    if (t.session_id !== sid) fail(`turns[${i}].session_id`, `must match session.id "${sid}"`);
    if (!segIdx.has(t.segment_index)) fail(`turns[${i}].segment_index`, `unknown segment ${t.segment_index}`);
    if (!actorIds.has(t.actor_id)) fail(`turns[${i}].actor_id`, `unknown actor "${t.actor_id}"`);
  });
  steps.forEach((s, i) => {
    if (s.session_id !== sid) fail(`steps[${i}].session_id`, `must match session.id "${sid}"`);
    if (!segIdx.has(s.segment_index)) fail(`steps[${i}].segment_index`, `unknown segment ${s.segment_index}`);
    if (!actorIds.has(s.actor_id)) fail(`steps[${i}].actor_id`, `unknown actor "${s.actor_id}"`);
    if (!turnIds.has(s.turn_id)) fail(`steps[${i}].turn_id`, `unknown turn "${s.turn_id}"`);
  });
  if (errors.length) return reject(400, "batch references unknown or mismatched records", errors);

  const conflicts: ValidationError[] = [];
  steps.forEach((s, i) => {
    const holder = refs.stepIdBySeq.get(s.seq);
    if (holder !== undefined && holder !== s.id) conflicts.push({ path: `steps[${i}].seq`, message: `seq ${s.seq} already belongs to step "${holder}"` });
  });
  if (conflicts.length) return reject(409, "step seq already taken in this session", conflicts);

  return { ok: true, batch: { session: header, segments, actors, turns, steps } };
}

function checkHeader(v: unknown, fail: (path: string, message: string) => void): SessionHeader | undefined {
  const p = "session";
  if (!isObj(v)) {
    fail(p, `required object, got ${kind(v)}`);
    return undefined;
  }
  let bad = 0;
  const f = (path: string, message: string) => {
    bad++;
    fail(`${p}.${path}`, message);
  };
  for (const k of Object.keys(v)) if (!HEADER_KEYS.includes(k)) f(k, "unknown field");
  str(v, "id", f);
  const agent = v["agent"];
  if (!isObj(agent)) f("agent", `required object, got ${kind(agent)}`);
  else {
    for (const k of Object.keys(agent)) if (!["kind", "version", "format_version"].includes(k)) f(`agent.${k}`, "unknown field");
    str(agent, "kind", f, "agent.");
    str(agent, "version", f, "agent.");
    str(agent, "format_version", f, "agent.", true);
  }
  const ws = v["workspace"];
  if (!isObj(ws)) f("workspace", `required object, got ${kind(ws)}`);
  else {
    for (const k of Object.keys(ws)) if (!["root", "repo"].includes(k)) f(`workspace.${k}`, "unknown field");
    str(ws, "root", f, "workspace.");
    str(ws, "repo", f, "workspace.", true);
  }
  ts(v, "started_at", f);
  ts(v, "ended_at", f, true);
  str(v, "source", f, "", true);
  if (v["metrics"] !== undefined) {
    const m = v["metrics"];
    if (!isObj(m)) f("metrics", `expected object, got ${kind(m)}`);
    else {
      for (const k of Object.keys(m)) if (!["cost_usd", "api_requests", "tokens"].includes(k)) f(`metrics.${k}`, "unknown field");
      if (typeof m["cost_usd"] !== "number" || !Number.isFinite(m["cost_usd"]) || m["cost_usd"] < 0) f("metrics.cost_usd", "expected a non-negative number");
      if (!isCount(m["api_requests"])) f("metrics.api_requests", "expected a non-negative integer");
      const t = m["tokens"];
      if (!isObj(t)) f("metrics.tokens", `expected object, got ${kind(t)}`);
      else {
        for (const k of Object.keys(t)) if (!["input", "output", "cache_read", "cache_creation"].includes(k)) f(`metrics.tokens.${k}`, "unknown field");
        for (const k of ["input", "output", "cache_read", "cache_creation"]) if (!isCount(t[k])) f(`metrics.tokens.${k}`, "expected a non-negative integer");
      }
    }
  }
  return bad === 0 ? (v as unknown as SessionHeader) : undefined;
}

function str(o: Record<string, unknown>, k: string, f: (path: string, msg: string) => void, prefix = "", optional = false): void {
  const v = o[k];
  if (v === undefined && optional) return;
  if (typeof v !== "string" || v.length === 0) f(`${prefix}${k}`, `${optional ? "if present, " : ""}expected non-empty string, got ${kind(v)}`);
}

function ts(o: Record<string, unknown>, k: string, f: (path: string, msg: string) => void, optional = false): void {
  const v = o[k];
  if (v === undefined && optional) return;
  if (typeof v !== "string" || !ISO_DATETIME.test(v) || Number.isNaN(Date.parse(v))) f(k, `expected ISO 8601 date-time with timezone, got ${kind(v)}`);
}

function dupes(values: Array<string | number>, key: string, field: string, fail: (path: string, msg: string) => void): void {
  const seen = new Map<string | number, number>();
  values.forEach((v, i) => {
    const first = seen.get(v);
    if (first !== undefined) fail(`${key}[${i}].${field}`, `duplicate of ${key}[${first}]`);
    else seen.set(v, i);
  });
}

function reject(status: 400 | 409 | 413, error: string, details?: ValidationError[]): IngestCheck {
  if (!details) return { ok: false, status, error };
  const omitted = Math.max(0, details.length - MAX_REPORTED_ERRORS);
  return { ok: false, status, error, details: details.slice(0, MAX_REPORTED_ERRORS), ...(omitted ? { omitted } : {}) };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function kind(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "string") return v.length > 40 ? `"${v.slice(0, 40)}..."` : `"${v}"`;
  if (typeof v === "number") return String(v);
  return typeof v;
}
