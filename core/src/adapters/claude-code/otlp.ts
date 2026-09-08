/**
 * OTLP logs channel reader (otlp-logs.ndjson).
 *
 * Per the v1.1 content-source rule this channel is NEVER a content source.
 * It is used only for ordering (event.sequence), correlation (tool_use_id,
 * prompt.id, request_id, message.uuid), cost, and tokens. Nothing in this
 * module should be used to populate stdout, old_string, new_string, or text.
 */

/** Raw OTLP AnyValue as it appears on the wire. */
export interface OtlpAnyValue {
  stringValue?: string;
  intValue?: number | string;
  doubleValue?: number;
  boolValue?: boolean;
}

interface OtlpLogRecord {
  timeUnixNano?: string;
  body?: OtlpAnyValue;
  attributes?: Array<{ key: string; value: OtlpAnyValue }>;
}

interface OtlpLogsWrapper {
  received_at?: string;
  payload?: {
    resourceLogs?: Array<{
      resource?: { attributes?: Array<{ key: string; value: OtlpAnyValue }> };
      scopeLogs?: Array<{ logRecords?: OtlpLogRecord[] }>;
    }>;
  };
}

export type AttrPrimitive = string | number | boolean;

export interface OtlpEvent {
  /** event.name attribute, e.g. "tool_result". */
  name: string;
  /** event.sequence, the one attribute that arrives as an int. */
  seq: number;
  /** event.timestamp, ISO 8601 with millisecond resolution. */
  timestamp: string;
  session_id: string;
  /** Flattened attributes; typed values are preserved as-is, strings stay strings. */
  attrs: Record<string, AttrPrimitive>;
  /** Resource attributes (service.version, host.arch, ...). */
  resource: Record<string, AttrPrimitive>;
}

function unwrap(v: OtlpAnyValue | undefined): AttrPrimitive | undefined {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return typeof v.intValue === "string" ? Number(v.intValue) : v.intValue;
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  return undefined;
}

function flatten(list: Array<{ key: string; value: OtlpAnyValue }> | undefined): Record<string, AttrPrimitive> {
  const out: Record<string, AttrPrimitive> = {};
  for (const a of list ?? []) {
    const v = unwrap(a.value);
    if (v !== undefined) out[a.key] = v;
  }
  return out;
}

/** Unwrap OTLP wrapper records (one per NDJSON line) into flat events. */
export function flattenOtlpLogs(wrappers: unknown[]): OtlpEvent[] {
  const events: OtlpEvent[] = [];
  for (const w of wrappers as OtlpLogsWrapper[]) {
    for (const rl of w.payload?.resourceLogs ?? []) {
      const resource = flatten(rl.resource?.attributes);
      for (const sl of rl.scopeLogs ?? []) {
        for (const r of sl.logRecords ?? []) {
          const attrs = flatten(r.attributes);
          const name = attrs["event.name"];
          const seq = attrs["event.sequence"];
          const timestamp = attrs["event.timestamp"];
          const session_id = attrs["session.id"];
          if (typeof name !== "string" || typeof session_id !== "string") continue;
          events.push({
            name,
            seq: typeof seq === "number" ? seq : Number(seq ?? NaN),
            timestamp: typeof timestamp === "string" ? timestamp : nanosToIso(r.timeUnixNano),
            session_id,
            attrs,
            resource,
          });
        }
      }
    }
  }
  return events;
}

function nanosToIso(nanos: string | undefined): string {
  if (!nanos) return "";
  const ms = Number(BigInt(nanos) / 1_000_000n);
  return new Date(ms).toISOString();
}

/** Read a string attribute. */
export function str(attrs: Record<string, AttrPrimitive>, key: string): string | undefined {
  const v = attrs[key];
  return typeof v === "string" ? v : v === undefined ? undefined : String(v);
}

/** Read a numeric attribute, parsing strings ("977") and accepting typed ints/doubles. */
export function num(attrs: Record<string, AttrPrimitive>, key: string): number | undefined {
  const v = attrs[key];
  if (v === undefined) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Read a boolean attribute. Accepts true/false, "true"/"false", "True"/"False". */
export function bool(attrs: Record<string, AttrPrimitive>, key: string): boolean | undefined {
  const v = attrs[key];
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return s === "true" ? true : s === "false" ? false : undefined;
}

/** Attributes present on every record; session-level identity, not step-level data. */
export const COMMON_ATTR_KEYS: ReadonlySet<string> = new Set([
  "user.id",
  "user.email",
  "user.account_uuid",
  "user.account_id",
  "organization.id",
  "session.id",
  "terminal.type",
  "event.name",
  "event.timestamp",
  "event.sequence",
]);

/** Event-specific attributes only, with the common identity keys removed. */
export function eventAttrs(ev: OtlpEvent): Record<string, AttrPrimitive> {
  const out: Record<string, AttrPrimitive> = {};
  for (const [k, v] of Object.entries(ev.attrs)) if (!COMMON_ATTR_KEYS.has(k)) out[k] = v;
  return out;
}
