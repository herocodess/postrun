/**
 * Light records: capture records with their bulky content (command output,
 * file contents, long prompts) replaced by a placeholder, keeping everything
 * the adapter uses to decide structure: ids, event names, prompt ids, tool
 * names, paths, errors, the final assistant reply, timestamps and telemetry
 * numbers.
 *
 * The incremental Claude Code ingest keeps a session's finished turns in this
 * form, so a long session costs a few hundred bytes per event in memory and
 * the adapter can still run over the whole session every turn. Steps built
 * from light records carry the placeholder in their payload; the store never
 * writes such a payload as content (see hasLightContent).
 */

import type { Step } from "../../schema/index.js";
import type { HookRecord } from "./hooks.js";
import type { OtlpEvent } from "./otlp.js";

/** Stands in for dropped content. The NUL byte keeps it from colliding with real text. */
export const LIGHT = "\u0000postrun:light";
const LIGHT_IN_JSON = JSON.stringify(LIGHT).slice(1, -1);

/** Strings up to this length are kept: paths, names, short commands. */
const KEEP_CHARS = 200;
/** Telemetry attributes the adapter reads as text: the error message and MCP tool names. */
const KEEP_ATTRS = new Set(["error", "tool_parameters"]);

function lightenValue(v: unknown): unknown {
  if (typeof v === "string") return v.length > KEEP_CHARS ? LIGHT : v;
  if (Array.isArray(v)) return v.map(lightenValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = lightenValue(x);
    return out;
  }
  return v;
}

/** A hook record without its bulky content. Errors and the final reply are kept: they shape steps. */
export function lightenHook(h: HookRecord): HookRecord {
  const p = h.payload;
  const payload = { ...p };
  if (p.tool_input !== undefined) payload.tool_input = lightenValue(p.tool_input) as Record<string, unknown>;
  if (p.tool_response !== undefined) payload.tool_response = lightenValue(p.tool_response);
  if (typeof p.prompt === "string" && p.prompt.length > KEEP_CHARS) payload.prompt = LIGHT;
  return { ...h, payload };
}

/** A telemetry event without long text attributes; the adapter never takes content from telemetry. */
export function lightenEvent(e: OtlpEvent): OtlpEvent {
  let attrs = e.attrs;
  for (const [k, v] of Object.entries(e.attrs)) {
    if (typeof v === "string" && v.length > KEEP_CHARS * 2 && !KEEP_ATTRS.has(k)) {
      if (attrs === e.attrs) attrs = { ...e.attrs };
      delete attrs[k];
    }
  }
  return attrs === e.attrs ? e : { ...e, attrs };
}

/** True when a step was built from light records, so its payload must not be stored as content. */
export function hasLightContent(step: Step): boolean {
  return JSON.stringify(step.payload).includes(LIGHT_IN_JSON);
}
