/**
 * Claude Code adapter: otlp-logs.ndjson + hooks.ndjson -> Step[].
 *
 * Content-source rule (v1.1, corrected; do not re-derive):
 * - HOOK is the primary content source (full tool_input, full tool_response).
 * - OTLP-LOGS is never a content source. Used only for ordering
 *   (event.sequence), correlation (tool_use_id, prompt.id, request_id,
 *   message.uuid), cost, and tokens.
 * - Join otlp tool_result -> hook record by tool_use_id.
 * - When the hook does not carry the content, leave the content field unset
 *   and point output_ref / text_ref at the raw body or transcript.
 *
 * Read only. Never writes to the capture directory.
 */

import { join } from "node:path";
import type {
  CommandPayload,
  ContentStatus,
  EditPayload,
  MessagePayload,
  OtherPayload,
  ReadPayload,
  SessionSegment,
  Step,
  StepDecision,
  StepError,
  StepOutcome,
  TokenUsage,
} from "../../schema/index.js";
import { readNdjson } from "./ndjson.js";
import { bool, eventAttrs, flattenOtlpLogs, num, str, type AttrPrimitive, type OtlpEvent } from "./otlp.js";
import {
  asNumber,
  asObject,
  asString,
  isHookRecord,
  type BashHookResponse,
  type EditHookResponse,
  type HookRecord,
} from "./hooks.js";

export const CHANNEL_OTEL = "otel"; // otlp-logs.ndjson (v1.1 section 6 name)
export const CHANNEL_HOOK = "hook";
export const ROOT_ACTOR_ID = "root"; // UNVERIFIED actor model; single root

export interface AdapterInput {
  otlpLogs: unknown[];
  hooks: unknown[];
  /** Restrict to one session. Defaults to the only session in otlp-logs; errors if there are several. */
  sessionId?: string;
  /** Names recorded on segments as source_files. */
  sourceFiles?: { otlpLogs: string; hooks: string };
}

export interface UnjoinedToolResult {
  seq: number;
  tool_use_id: string;
  tool_name: string;
}

export interface AdapterStats {
  session_id: string;
  otlp_events_total: number;
  otlp_events_by_name: Record<string, number>;
  hook_records_for_session: number;
  hook_records_by_event: Record<string, number>;
  steps_total: number;
  steps_by_type: Record<string, number>;
  tool_results: { total: number; joined: number; unjoined: UnjoinedToolResult[] };
  /** Hook tool records (PostToolUse / PostToolUseFailure) with no otlp tool_result. Not emitted: no seq available. */
  hook_tool_uses_without_otlp: string[];
  /** Tool names that fell through to OtherPayload, with counts. */
  other_tool_names: Record<string, number>;
  /** otlp events that are not steps (telemetry, lifecycle, cost). Counted, not emitted. */
  non_step_events: Record<string, number>;
  messages: {
    user: { inline: number; reference_only: number };
    assistant: { inline: number; reference_only: number };
  };
  /** Steps whose turn could not be determined (no prompt.id). */
  steps_without_prompt_id: number;
  /** Session working directory as reported on hook records (the agent's cwd), when any hook record exists. */
  cwd?: string;
  /** Claude Code version from the OTel resource (service.version), when present. */
  agent_version?: string;
  totals: { cost_usd: number; cost_usd_micros: number; api_requests: number; tokens: TokenUsage };
  segments: SessionSegment[];
}

export interface AdapterResult {
  session_id: string;
  steps: Step[];
  segments: SessionSegment[];
  stats: AdapterStats;
}

export interface CaptureDirResult extends AdapterResult {
  lines: {
    otlp_logs: { path: string; total: number; skipped: number; skipped_lines: number[] };
    hooks: { path: string; total: number; skipped: number; skipped_lines: number[] };
  };
}

/** Session ids present in otlp-logs.ndjson, in order of first appearance. A live capture file accumulates many. */
export function listCaptureSessions(dir: string): string[] {
  const otlp = readNdjson(join(dir, "otlp-logs.ndjson"));
  const ids: string[] = [];
  for (const e of flattenOtlpLogs(otlp.records)) if (!ids.includes(e.session_id)) ids.push(e.session_id);
  return ids;
}

/** Read otlp-logs.ndjson and hooks.ndjson from a captures directory and adapt them. */
export function readCaptureDir(dir: string, sessionId?: string): CaptureDirResult {
  const otlpPath = join(dir, "otlp-logs.ndjson");
  const hooksPath = join(dir, "hooks.ndjson");
  const otlp = readNdjson(otlpPath);
  const hooks = readNdjson(hooksPath);
  const input: AdapterInput = {
    otlpLogs: otlp.records,
    hooks: hooks.records,
    sourceFiles: { otlpLogs: "otlp-logs.ndjson", hooks: "hooks.ndjson" },
  };
  if (sessionId !== undefined) input.sessionId = sessionId;
  const result = adaptClaudeCode(input);
  return {
    ...result,
    lines: {
      otlp_logs: { path: otlpPath, total: otlp.total, skipped: otlp.skipped, skipped_lines: otlp.skipped_lines },
      hooks: { path: hooksPath, total: hooks.total, skipped: hooks.skipped, skipped_lines: hooks.skipped_lines },
    },
  };
}

export function adaptClaudeCode(input: AdapterInput): AdapterResult {
  const allEvents = flattenOtlpLogs(input.otlpLogs);
  const sessionId = pickSession(allEvents, input.sessionId);
  const events = allEvents.filter((e) => e.session_id === sessionId).sort((a, b) => a.seq - b.seq);
  const hooks = input.hooks.filter(isHookRecord).filter((h) => h.payload.session_id === sessionId);

  // ---- Correlation indexes (hook channel) ----
  const hookByToolUseId = new Map<string, HookRecord>();
  const promptHookByPromptId = new Map<string, HookRecord>();
  const stopHooksByPromptId = new Map<string, HookRecord[]>();
  let transcriptPath: string | undefined;
  const hookRecordsByEvent: Record<string, number> = {};
  for (const h of hooks) {
    const p = h.payload;
    hookRecordsByEvent[p.hook_event_name] = (hookRecordsByEvent[p.hook_event_name] ?? 0) + 1;
    transcriptPath ??= p.transcript_path;
    if ((p.hook_event_name === "PostToolUse" || p.hook_event_name === "PostToolUseFailure") && p.tool_use_id) {
      if (!hookByToolUseId.has(p.tool_use_id)) hookByToolUseId.set(p.tool_use_id, h);
    } else if (p.hook_event_name === "UserPromptSubmit" && p.prompt_id) {
      if (!promptHookByPromptId.has(p.prompt_id)) promptHookByPromptId.set(p.prompt_id, h);
    } else if (p.hook_event_name === "Stop" && p.prompt_id) {
      const list = stopHooksByPromptId.get(p.prompt_id) ?? [];
      list.push(h);
      stopHooksByPromptId.set(p.prompt_id, list);
    }
  }

  // ---- Correlation indexes (otlp channel; identifiers and pointers only) ----
  const decisionByToolUseId = new Map<string, OtlpEvent>();
  const responseBodyByRequestId = new Map<string, OtlpEvent>();
  const otlpEventsByName: Record<string, number> = {};
  const mainThreadResponsesByPrompt = new Map<string, OtlpEvent[]>();
  const totals = { cost_usd: 0, cost_usd_micros: 0, api_requests: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 } };
  for (const e of events) {
    otlpEventsByName[e.name] = (otlpEventsByName[e.name] ?? 0) + 1;
    switch (e.name) {
      case "tool_decision": {
        const id = str(e.attrs, "tool_use_id");
        if (id) decisionByToolUseId.set(id, e);
        break;
      }
      case "api_response_body": {
        const rid = str(e.attrs, "request_id");
        if (rid) responseBodyByRequestId.set(rid, e);
        break;
      }
      case "api_request": {
        totals.api_requests++;
        totals.cost_usd += num(e.attrs, "cost_usd") ?? 0;
        totals.cost_usd_micros += num(e.attrs, "cost_usd_micros") ?? 0;
        totals.tokens.input += num(e.attrs, "input_tokens") ?? 0;
        totals.tokens.output += num(e.attrs, "output_tokens") ?? 0;
        totals.tokens.cache_read += num(e.attrs, "cache_read_tokens") ?? 0;
        totals.tokens.cache_creation += num(e.attrs, "cache_creation_tokens") ?? 0;
        break;
      }
      case "assistant_response": {
        if (isMainThread(e)) {
          const pid = str(e.attrs, "prompt.id") ?? "";
          const list = mainThreadResponsesByPrompt.get(pid) ?? [];
          list.push(e);
          mainThreadResponsesByPrompt.set(pid, list);
        }
        break;
      }
    }
  }
  // The Stop hook's last_assistant_message belongs to the LAST main-thread assistant_response of that prompt.
  const finalResponseSeqByPrompt = new Map<string, number>();
  for (const [pid, list] of mainThreadResponsesByPrompt) {
    const last = list[list.length - 1];
    if (last) finalResponseSeqByPrompt.set(pid, last.seq);
  }

  // ---- Segments ----
  const segments = buildSegments(hooks, events, input.sourceFiles);
  const segmentIndexFor = (at: string): number => {
    let idx = 0;
    for (const s of segments) if (s.started_at <= at) idx = s.index;
    return idx;
  };

  // ---- Steps ----
  const steps: Step[] = [];
  const stats: AdapterStats = {
    session_id: sessionId,
    otlp_events_total: events.length,
    otlp_events_by_name: otlpEventsByName,
    hook_records_for_session: hooks.length,
    hook_records_by_event: hookRecordsByEvent,
    steps_total: 0,
    steps_by_type: {},
    tool_results: { total: 0, joined: 0, unjoined: [] },
    hook_tool_uses_without_otlp: [],
    other_tool_names: {},
    non_step_events: {},
    messages: { user: { inline: 0, reference_only: 0 }, assistant: { inline: 0, reference_only: 0 } },
    steps_without_prompt_id: 0,
    totals,
    segments,
  };
  const seenToolUseIds = new Set<string>();

  const base = (
    e: OtlpEvent,
    id: string,
    decision: StepDecision,
    outcome: StepOutcome,
    content_status: ContentStatus,
    channels: string[],
    error?: StepError,
  ): StepBaseFields => {
    const pid = str(e.attrs, "prompt.id");
    if (!pid) stats.steps_without_prompt_id++;
    const b: StepBaseFields = {
      id,
      session_id: sessionId,
      segment_index: segmentIndexFor(e.timestamp),
      turn_id: pid ? `turn:${pid}` : "turn:unknown",
      actor_id: ROOT_ACTOR_ID,
      seq: e.seq,
      at: e.timestamp,
      decision,
      outcome,
      content_status,
      channels,
      flags: [],
    };
    if (error) b.error = error;
    return b;
  };

  for (const e of events) {
    if (e.name === "tool_result") {
      stats.tool_results.total++;
      const toolUseId = str(e.attrs, "tool_use_id") ?? `otel:seq-${e.seq}`;
      const hook = hookByToolUseId.get(toolUseId);
      if (hook) {
        stats.tool_results.joined++;
        seenToolUseIds.add(toolUseId);
      }
      const toolName = hook?.payload.tool_name ?? otlpToolName(e);
      if (!hook) stats.tool_results.unjoined.push({ seq: e.seq, tool_use_id: toolUseId, tool_name: toolName });
      const decision = toolDecision(e, decisionByToolUseId.get(toolUseId));
      const outcome = toolOutcome(e, hook);
      const error = outcome === "failed" ? toolError(e, hook) : undefined;
      const channels = hook ? [CHANNEL_OTEL, CHANNEL_HOOK] : [CHANNEL_OTEL];
      // No hook record means no readable content on either channel: reference only (A2).
      const b = base(e, toolUseId, decision, outcome, hook ? "inline" : "reference_only", channels, error);
      const transcriptRef = transcriptPath ? `${transcriptPath}#tool_use_id=${toolUseId}` : undefined;
      steps.push(toolStep(b, toolName, hook, e, transcriptRef, stats));
      continue;
    }
    if (e.name === "user_prompt") {
      const pid = str(e.attrs, "prompt.id");
      const uuid = str(e.attrs, "message.uuid");
      const hook = pid ? promptHookByPromptId.get(pid) : undefined;
      const text = hook?.payload.prompt;
      const payload: MessagePayload = { role: "user" };
      let contentStatus: ContentStatus;
      if (typeof text === "string") {
        payload.text = text;
        contentStatus = "inline";
        stats.messages.user.inline++;
      } else {
        contentStatus = "reference_only";
        stats.messages.user.reference_only++;
        const ref = transcriptPath ? `${transcriptPath}#message.uuid=${uuid ?? `seq-${e.seq}`}` : undefined;
        if (ref) payload.text_ref = ref;
      }
      const b = base(e, uuid ?? `msg:seq-${e.seq}`, "n/a", "ok", contentStatus, hook ? [CHANNEL_OTEL, CHANNEL_HOOK] : [CHANNEL_OTEL]);
      steps.push({ ...b, type: "message", payload });
      continue;
    }
    if (e.name === "assistant_response") {
      const pid = str(e.attrs, "prompt.id") ?? "";
      const uuid = str(e.attrs, "message.uuid");
      const requestId = str(e.attrs, "request_id");
      if (!isMainThread(e)) {
        // Side calls (session title generation, prompt suggestion) are not assistant messages to the user.
        // The otlp `response` attribute is content and is deliberately dropped.
        const qs = str(e.attrs, "query_source") ?? "unknown";
        const toolName = `assistant_response:${qs}`;
        const raw = eventAttrs(e);
        delete raw["response"];
        const bodyRef = requestId ? str(responseBodyByRequestId.get(requestId)?.attrs ?? {}, "body_ref") : undefined;
        if (bodyRef) raw["body_ref"] = bodyRef;
        stats.other_tool_names[toolName] = (stats.other_tool_names[toolName] ?? 0) + 1;
        // The response text is only in the raw body (body_ref), so this is reference only.
        const b = base(e, uuid ?? `msg:seq-${e.seq}`, "n/a", "ok", "reference_only", [CHANNEL_OTEL]);
        steps.push({ ...b, type: "other", payload: { tool_name: toolName, raw } });
        continue;
      }
      const payload: MessagePayload = { role: "assistant" };
      let fromHook = false;
      if (finalResponseSeqByPrompt.get(pid) === e.seq) {
        // The Stop hook carries the final assistant message of the turn. Guard with the
        // otlp response_length (a length, not content) so a mismatched Stop is not attached.
        const stops = stopHooksByPromptId.get(pid) ?? [];
        const expectedLen = num(e.attrs, "response_length");
        const stop = stops.find(
          (s) => typeof s.payload.last_assistant_message === "string" && (expectedLen === undefined || s.payload.last_assistant_message.length === expectedLen),
        );
        if (stop && typeof stop.payload.last_assistant_message === "string") {
          payload.text = stop.payload.last_assistant_message;
          fromHook = true;
        }
      }
      if (fromHook) {
        stats.messages.assistant.inline++;
      } else {
        stats.messages.assistant.reference_only++;
        const bodyRef = requestId ? str(responseBodyByRequestId.get(requestId)?.attrs ?? {}, "body_ref") : undefined;
        const ref = bodyRef ?? (transcriptPath ? `${transcriptPath}#message.uuid=${uuid ?? `seq-${e.seq}`}` : undefined);
        if (ref) payload.text_ref = ref;
      }
      const b = base(e, uuid ?? `msg:seq-${e.seq}`, "n/a", "ok", fromHook ? "inline" : "reference_only", fromHook ? [CHANNEL_OTEL, CHANNEL_HOOK] : [CHANNEL_OTEL]);
      steps.push({ ...b, type: "message", payload });
      continue;
    }
    stats.non_step_events[e.name] = (stats.non_step_events[e.name] ?? 0) + 1;
  }

  for (const id of hookByToolUseId.keys()) if (!seenToolUseIds.has(id)) stats.hook_tool_uses_without_otlp.push(id);
  const cwd = hooks.find((h) => typeof h.payload.cwd === "string")?.payload.cwd;
  if (cwd) stats.cwd = cwd;
  const version = events.find((e) => typeof e.resource["service.version"] === "string")?.resource["service.version"];
  if (typeof version === "string") stats.agent_version = version;

  steps.sort((a, b) => a.seq - b.seq);
  stats.steps_total = steps.length;
  for (const s of steps) stats.steps_by_type[s.type] = (stats.steps_by_type[s.type] ?? 0) + 1;

  return { session_id: sessionId, steps, segments, stats };
}

// ---------------------------------------------------------------------------

function pickSession(events: OtlpEvent[], requested: string | undefined): string {
  const ids = new Set(events.map((e) => e.session_id));
  if (requested !== undefined) {
    if (!ids.has(requested)) throw new Error(`session ${requested} not found in otlp-logs (have: ${[...ids].join(", ") || "none"})`);
    return requested;
  }
  if (ids.size === 0) throw new Error("no session found in otlp-logs");
  if (ids.size > 1) throw new Error(`otlp-logs holds ${ids.size} sessions; pass sessionId (${[...ids].join(", ")})`);
  return [...ids][0] as string;
}

/** Interactive sessions report "repl_main_thread"; `claude -p` (SDK / print mode) reports "sdk". Both are the user-facing thread. */
function isMainThread(e: OtlpEvent): boolean {
  const qs = str(e.attrs, "query_source");
  return qs === undefined || qs === "repl_main_thread" || qs === "sdk";
}

/** Tool name from otlp only (no hook). mcp_tool is a placeholder; the real name is in tool_parameters. */
function otlpToolName(e: OtlpEvent): string {
  const name = str(e.attrs, "tool_name") ?? "unknown";
  if (name !== "mcp_tool") return name;
  const params = str(e.attrs, "tool_parameters");
  if (params) {
    try {
      const p = JSON.parse(params) as { mcp_server_name?: string; mcp_tool_name?: string };
      if (p.mcp_server_name && p.mcp_tool_name) return `mcp__${p.mcp_server_name}__${p.mcp_tool_name}`;
    } catch {
      /* fall through */
    }
  }
  return name;
}

/**
 * A4: permission decision. tool_decision carries decision ("accept" | ...) and source
 * ("config" | "user_temporary" | "user_permanent"). A config-sourced accept is the
 * auto-approve path, so it maps to "auto"; a user-sourced accept is "accepted".
 * Anything other than accept is "rejected" (UNPROVEN: no denial captured yet).
 * With no decision record at all, default to "auto".
 */
function toolDecision(e: OtlpEvent, decision: OtlpEvent | undefined): StepDecision {
  const d = decision ? str(decision.attrs, "decision") : str(e.attrs, "decision_type");
  const source = decision ? str(decision.attrs, "source") : str(e.attrs, "decision_source");
  if (d === undefined) return "auto";
  if (d !== "accept") return "rejected";
  return source === undefined || source === "config" ? "auto" : "accepted";
}

/** A4: execution outcome from the PostToolUseFailure hook or the otlp success flag. */
function toolOutcome(e: OtlpEvent, hook: HookRecord | undefined): StepOutcome {
  if (hook?.payload.hook_event_name === "PostToolUseFailure") return "failed";
  if (bool(e.attrs, "success") === false) return "failed";
  return "ok";
}

/** A3: error type from otlp error_type; message from the hook when present, else otlp. */
function toolError(e: OtlpEvent, hook: HookRecord | undefined): StepError | undefined {
  const message = hook?.payload.error ?? str(e.attrs, "error");
  if (message === undefined) return undefined;
  return { type: str(e.attrs, "error_type") ?? "unknown", message };
}

type StepBaseFields = Omit<Extract<Step, { type: "other" }>, "type" | "payload">;

function toolStep(
  b: StepBaseFields,
  toolName: string,
  hook: HookRecord | undefined,
  e: OtlpEvent,
  transcriptRef: string | undefined,
  stats: AdapterStats,
): Step {
  const input = hook ? (asObject(hook.payload.tool_input) ?? {}) : {};
  const response = hook ? hook.payload.tool_response : undefined;
  const failed = hook?.payload.hook_event_name === "PostToolUseFailure";

  switch (toolName) {
    case "Bash": {
      // A2: no hook means the command is not on a readable channel; leave it absent, never "".
      const payload: CommandPayload = {};
      const command = asString(input["command"]);
      if (command !== undefined) payload.command = command;
      const r = (asObject(response) ?? {}) as BashHookResponse;
      if (typeof r.stdout === "string") payload.stdout = r.stdout;
      if (typeof r.stderr === "string") payload.stderr = r.stderr;
      if (failed && typeof hook?.payload.error === "string") {
        // PostToolUseFailure for Bash puts "Exit code N\n<stderr>" in `error`. Parse the code, keep the rest as stderr.
        const m = /^Exit code (\d+)\n?/.exec(hook.payload.error);
        if (m) {
          payload.exit_code = Number(m[1]);
          const rest = hook.payload.error.slice(m[0].length);
          if (rest.length > 0) payload.stderr = rest;
        } else {
          payload.stderr = hook.payload.error;
        }
      }
      const cwd = hook?.payload.cwd;
      if (typeof cwd === "string") payload.cwd = cwd;
      if (typeof r.persistedOutputPath === "string") payload.output_ref = r.persistedOutputPath;
      else if (!hook && transcriptRef) payload.output_ref = transcriptRef;
      return { ...b, type: "command", payload };
    }
    case "Edit":
    case "Write": {
      const r = (asObject(response) ?? {}) as EditHookResponse;
      const payload: EditPayload = {
        path: asString(input["file_path"]) ?? asString(r.filePath) ?? "",
        is_full_write: toolName === "Write",
      };
      const oldString = asString(input["old_string"]) ?? asString(r.oldString);
      const newString = asString(input["new_string"]) ?? asString(r.newString) ?? asString(input["content"]);
      if (oldString !== undefined) payload.old_string = oldString;
      if (newString !== undefined) payload.new_string = newString;
      // A5: the hook's own structured diff, kept verbatim with its companions.
      if (r.structuredPatch !== undefined) {
        const sp: Record<string, unknown> = { structuredPatch: r.structuredPatch };
        if (r.originalFile !== undefined) sp["originalFile"] = r.originalFile;
        if (r.userModified !== undefined) sp["userModified"] = r.userModified;
        payload.structured_patch = sp;
      }
      // landed_in_final_state is a projection; intentionally left unset.
      return { ...b, type: "edit", payload };
    }
    case "Read": {
      const payload: ReadPayload = { path: asString(input["file_path"]) ?? "" };
      const offset = asNumber(input["offset"]);
      const limit = asNumber(input["limit"]);
      if (limit !== undefined) {
        const start = offset ?? 1;
        payload.range = [start, start + limit - 1];
      }
      return { ...b, type: "read", payload };
    }
    default: {
      stats.other_tool_names[toolName] = (stats.other_tool_names[toolName] ?? 0) + 1;
      const otel = eventAttrs(e);
      delete otel["tool_input"]; // truncated content; never carried forward
      const raw: Record<string, unknown> = { otel };
      if (hook) {
        raw["hook_event"] = hook.payload.hook_event_name;
        raw["tool_input"] = hook.payload.tool_input;
        if (response !== undefined) raw["tool_response"] = response;
        if (hook.payload.error !== undefined) raw["error"] = hook.payload.error;
      } else if (transcriptRef) {
        raw["ref"] = transcriptRef;
      }
      const payload: OtherPayload = { tool_name: toolName, raw };
      return { ...b, type: "other", payload };
    }
  }
}

function buildSegments(
  hooks: HookRecord[],
  events: OtlpEvent[],
  sourceFiles: AdapterInput["sourceFiles"],
): SessionSegment[] {
  const files = sourceFiles ? [sourceFiles.otlpLogs, sourceFiles.hooks] : [];
  const starts = hooks.filter((h) => h.payload.hook_event_name === "SessionStart");
  const ends = hooks.filter((h) => h.payload.hook_event_name === "SessionEnd");
  const segments: SessionSegment[] = [];
  if (starts.length === 0) {
    const first = events[0];
    const last = events[events.length - 1];
    const seg: SessionSegment = { index: 0, start_reason: "unknown", started_at: first?.timestamp ?? "", source_files: files };
    if (last) seg.ended_at = last.timestamp;
    return [seg];
  }
  starts.sort((a, b) => a.received_at.localeCompare(b.received_at));
  starts.forEach((s, i) => {
    const next = starts[i + 1];
    const seg: SessionSegment = {
      index: i,
      start_reason: s.payload.source ?? "unknown",
      started_at: s.received_at,
      source_files: files,
    };
    const end = ends.find((e) => e.received_at >= s.received_at && (!next || e.received_at <= next.received_at));
    if (end) seg.ended_at = end.received_at;
    segments.push(seg);
  });
  return segments;
}

export type { AttrPrimitive };
