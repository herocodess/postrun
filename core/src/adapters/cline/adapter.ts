/**
 * Cline adapter: <id>.messages.json (+ <id>.json metadata) -> v1.2 Step[], Turn[], Actor[].
 *
 * Atom model is the same as Claude Code: one step per tool call, message, or
 * thinking block. Cline batches tool calls (run_commands takes commands[]),
 * so one tool_use can yield several steps; their ids are "<tool_use_id>#<i>".
 *
 * Ordering: by array index. Message ts is NOT monotonic in the real capture
 * (5 of 151 go backwards), so seq is a running counter in array order and
 * segment assignment uses a suffix-minimum timestamp (see segmentFor).
 *
 * Channels: the whole session comes from one file, the "conversation" channel.
 *
 * PROVISIONAL (marked inline): segments from checkpoint runCount, decision from
 * auto-approval settings, thinking blocks as message role "thinking".
 *
 * Read only.
 */

import type {
  Actor,
  AgentInfo,
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
  Turn,
  Workspace,
} from "../../schema/index.js";
import {
  isText,
  isThinking,
  isToolResult,
  isToolUse,
  type ClineAutoApproval,
  type ClineMessage,
  type ClineResultItem,
  type ClineSessionInput,
  type ClineToolUseBlock,
} from "./store.js";

export const CHANNEL_CONVERSATION = "conversation";
export const ROOT_ACTOR_ID = "root";

export interface ClineAdapterStats {
  session_id: string;
  messages_total: number;
  blocks_by_role_type: Record<string, number>;
  tool_uses: number;
  tool_use_items: number; // after unbatching
  tool_uses_without_result: string[];
  steps_total: number;
  steps_by_type: Record<string, number>;
  other_tool_names: Record<string, number>;
  decision: Record<string, number>;
  outcome: Record<string, number>;
  content_status: Record<string, number>;
  proceed_while_running: number; // command output side-channeled to a temp log
  turns_by_mode: Record<string, number>;
  backwards_ts: number; // messages whose ts is earlier than the previous message
  /** How decision was derived: "auto_approval_settings" when globalState.json was available, else "default". */
  decision_source: "auto_approval_settings" | "default";
  totals: {
    from_metrics: { cost_usd: number; api_requests: number; tokens: TokenUsage };
    from_metadata?: { cost_usd: number; tokens: TokenUsage };
  };
  segments: SessionSegment[];
}

export interface ClineAdapterResult {
  session_id: string;
  agent: AgentInfo;
  workspace: Workspace;
  actors: Actor[];
  segments: SessionSegment[];
  turns: Turn[];
  steps: Step[];
  stats: ClineAdapterStats;
}

type StepBaseFields = Omit<Extract<Step, { type: "other" }>, "type" | "payload">;

const iso = (ms: number | undefined): string => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : "");

function tally(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function adaptCline(input: ClineSessionInput): ClineAdapterResult {
  const { doc, meta } = input;
  const sessionId = doc.sessionId ?? meta?.session_id ?? input.files.session_id;
  const version = doc.origin?.version ?? meta?.metadata?.sessionHistoryOrigin?.version ?? "unknown";
  const agent: AgentInfo = { kind: "cline", version, format_version: "current" }; // "legacy" = VS Code globalStorage task dirs, not read here
  const workspace: Workspace = { root: meta?.workspace_root ?? meta?.cwd ?? "" };
  if (meta?.metadata?.git?.url) workspace.repo = meta.metadata.git.url;
  // Cline has no subagents in this session (enable_spawn false): exactly one root actor.
  const actors: Actor[] = [{ id: ROOT_ACTOR_ID, type: "root", label: doc.agent ?? "cline" }];

  const segments = buildSegments(meta, doc.messages);
  const stats: ClineAdapterStats = {
    session_id: sessionId,
    messages_total: doc.messages.length,
    blocks_by_role_type: {},
    tool_uses: 0,
    tool_use_items: 0,
    tool_uses_without_result: [],
    steps_total: 0,
    steps_by_type: {},
    other_tool_names: {},
    decision: {},
    outcome: {},
    content_status: {},
    proceed_while_running: 0,
    turns_by_mode: {},
    backwards_ts: 0,
    decision_source: input.autoApproval ? "auto_approval_settings" : "default",
    totals: { from_metrics: { cost_usd: 0, api_requests: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 } } },
    segments,
  };
  if (meta?.metadata?.usage) {
    const u = meta.metadata.usage;
    stats.totals.from_metadata = {
      cost_usd: u.totalCost ?? meta.metadata.totalCost ?? 0,
      tokens: { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, cache_read: u.cacheReadTokens ?? 0, cache_creation: u.cacheWriteTokens ?? 0 },
    };
  }

  const steps: Step[] = [];
  const turns: Turn[] = [];
  let seq = 0;
  let currentTurn: Turn | undefined;
  const pending = new Map<string, { use: ClineToolUseBlock; at: string; turnId: string; segment: number }>();

  // Segment assignment uses a suffix-minimum timestamp: the observed anomaly is user
  // messages rewritten with a LATER ts on resume (5 share one ts in the real capture),
  // so a message's effective time is the earliest ts at or after it in array order.
  // Step.at keeps the raw ts; only segment assignment uses the corrected value.
  const effectiveTs = new Array<number>(doc.messages.length);
  for (let i = doc.messages.length - 1, min = Infinity; i >= 0; i--) {
    const ts = doc.messages[i]?.ts ?? Infinity;
    if (ts < min) min = ts;
    effectiveTs[i] = min;
  }
  const segmentFor = (mi: number): number => {
    const at = iso(effectiveTs[mi] ?? doc.messages[mi]?.ts);
    let idx = 0;
    for (const s of segments) if (s.started_at <= at) idx = s.index;
    return idx;
  };

  const base = (
    id: string,
    at: string,
    segment: number,
    turnId: string,
    decision: StepDecision,
    outcome: StepOutcome,
    content_status: ContentStatus,
    error?: StepError,
  ): StepBaseFields => {
    const b: StepBaseFields = {
      id,
      session_id: sessionId,
      segment_index: segment,
      turn_id: turnId,
      actor_id: ROOT_ACTOR_ID,
      seq: seq++,
      at,
      decision,
      outcome,
      content_status,
      channels: [CHANNEL_CONVERSATION],
      flags: [],
    };
    if (error) b.error = error;
    tally(stats.decision, decision);
    tally(stats.outcome, outcome);
    tally(stats.content_status, content_status);
    return b;
  };

  let prevTs = -Infinity;
  doc.messages.forEach((m, mi) => {
    if (m.ts < prevTs) stats.backwards_ts++;
    prevTs = m.ts;
    const at = iso(m.ts);
    const segment = segmentFor(mi);
    if (m.role === "assistant" && m.metrics) {
      stats.totals.from_metrics.api_requests++;
      stats.totals.from_metrics.cost_usd += m.metrics.cost ?? 0;
      stats.totals.from_metrics.tokens.input += m.metrics.inputTokens ?? 0;
      stats.totals.from_metrics.tokens.output += m.metrics.outputTokens ?? 0;
      stats.totals.from_metrics.tokens.cache_read += m.metrics.cacheReadTokens ?? 0;
      stats.totals.from_metrics.tokens.cache_creation += m.metrics.cacheWriteTokens ?? 0;
    }
    m.content.forEach((b, bi) => {
      tally(stats.blocks_by_role_type, `${m.role}:${b.type}`);
      const blockId = `${m.id ?? `m${mi}`}#${bi}`;

      if (m.role === "user" && isText(b)) {
        // A user text block opens a new turn. Cline wraps it as <user_input mode="act|plan">...</user_input>.
        const { mode, text } = parseUserInput(b.text);
        const turn: Turn = {
          id: `turn:${turns.length + 1}`,
          session_id: sessionId,
          segment_index: segment,
          actor_id: ROOT_ACTOR_ID,
          index: turns.length + 1,
          prompt_id: m.id,
          started_at: at,
          step_ids: [],
        };
        if (mode !== undefined) {
          turn.mode = mode; // agent's own string ("act" | "plan"); not normalized in v1.x
          tally(stats.turns_by_mode, mode);
        }
        turns.push(turn);
        currentTurn = turn;
        const payload: MessagePayload = { role: "user", text };
        const step: Step = { ...base(blockId, at, segment, turn.id, "n/a", "ok", "inline"), type: "message", payload };
        steps.push(step);
        turn.step_ids.push(step.id);
        return;
      }

      const turnId = currentTurn?.id ?? "turn:unknown";
      const record = (step: Step) => {
        steps.push(step);
        currentTurn?.step_ids.push(step.id);
      };

      if (m.role === "assistant" && isText(b)) {
        record({ ...base(blockId, at, segment, turnId, "n/a", "ok", "inline"), type: "message", payload: { role: "assistant", text: b.text } });
        return;
      }
      if (m.role === "assistant" && isThinking(b)) {
        // PROVISIONAL: v1.2 has no thinking concept. Kept as a message with role "thinking" so nothing is dropped.
        record({ ...base(blockId, at, segment, turnId, "n/a", "ok", "inline"), type: "message", payload: { role: "thinking", text: b.thinking } });
        return;
      }
      if (m.role === "assistant" && isToolUse(b)) {
        stats.tool_uses++;
        pending.set(b.id, { use: b, at, turnId, segment });
        return;
      }
      if (m.role === "user" && isToolResult(b)) {
        const p = pending.get(b.tool_use_id);
        if (!p) return; // result without a call: nothing to attach it to (not observed)
        pending.delete(b.tool_use_id);
        for (const s of toolSteps(p.use, b.content, b.is_error === true, p.at, p.segment, p.turnId, base, input.autoApproval, stats, workspace.root)) record(s);
        return;
      }
      // Unknown block type: keep it as "other" rather than dropping it.
      record({
        ...base(blockId, at, segment, turnId, "n/a", "ok", "inline"),
        type: "other",
        payload: { tool_name: `block:${b.type}`, raw: { block: b } },
      });
      tally(stats.other_tool_names, `block:${b.type}`);
    });
  });

  // Tool calls that never got a result (not observed in the real session; emitted so they are not lost).
  for (const [id, p] of pending) {
    stats.tool_uses_without_result.push(id);
    for (const s of toolSteps(p.use, undefined, false, p.at, p.segment, p.turnId, base, input.autoApproval, stats, workspace.root)) {
      steps.push(s);
      turns.find((t) => t.id === p.turnId)?.step_ids.push(s.id);
    }
  }

  stats.steps_total = steps.length;
  for (const s of steps) tally(stats.steps_by_type, s.type);

  return { session_id: sessionId, agent, workspace, actors, segments, turns, steps, stats };
}

// ---------------------------------------------------------------------------

function parseUserInput(text: string): { mode: string | undefined; text: string } {
  const m = /^\s*<user_input(?:\s+mode="([^"]*)")?\s*>([\s\S]*?)<\/user_input>\s*$/.exec(text);
  if (!m) return { mode: undefined, text };
  return { mode: m[1], text: m[2] ?? "" };
}

/** Which input array a batched tool uses. The editor tool is not batched. */
const BATCH_KEYS: Record<string, string> = {
  run_commands: "commands",
  read_files: "files",
  search_codebase: "queries",
  fetch_web_content: "requests",
};

function resultItems(content: unknown): ClineResultItem[] | undefined {
  if (content === undefined) return undefined;
  if (Array.isArray(content)) return content as ClineResultItem[];
  if (typeof content === "string") {
    try {
      const parsed: unknown = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed as ClineResultItem[];
      if (typeof parsed === "object" && parsed !== null) return [parsed as ClineResultItem];
    } catch {
      /* plain text result */
    }
    return [{ result: content }];
  }
  if (typeof content === "object" && content !== null) return [content as ClineResultItem];
  return undefined;
}

/**
 * PROVISIONAL decision mapping. Cline records NO per-call approval in the session
 * file. The only evidence is the global auto-approval settings, which say which
 * tool categories were auto-approved; a tool in a non-auto category that ran must
 * have been accepted by the user. Commands cannot be split into safe vs unsafe
 * from the capture, so with executeSafeCommands they are reported as "auto".
 */
function toolDecision(toolName: string, aa: ClineAutoApproval | undefined): StepDecision {
  if (!aa || aa.enabled === false) return "auto";
  const a = aa.actions ?? {};
  switch (toolName) {
    case "read_files":
    case "search_codebase":
      return a.readFiles ? "auto" : "accepted";
    case "editor":
      return a.editFiles ? "auto" : "accepted";
    case "run_commands":
      return a.executeAllCommands || a.executeSafeCommands ? "auto" : "accepted";
    case "fetch_web_content":
      return a.useBrowser ? "auto" : "accepted";
    default:
      return a.useMcp ? "auto" : "accepted";
  }
}

const PROCEED_RE = /The user chose to proceed while the command is (?:starting or )?(?:still )?running/;
const PROCEED_LOG_RE = /redirected to this file[^:]*:\s*(\S+)/;
const EXIT_CODE_RE = /Command exited with code (\d+)/;

function toolSteps(
  use: ClineToolUseBlock,
  content: unknown,
  isError: boolean,
  at: string,
  segment: number,
  turnId: string,
  base: (id: string, at: string, segment: number, turnId: string, d: StepDecision, o: StepOutcome, c: ContentStatus, e?: StepError) => StepBaseFields,
  aa: ClineAutoApproval | undefined,
  stats: ClineAdapterStats,
  cwd: string,
): Step[] {
  const items = resultItems(content);
  const batchKey = BATCH_KEYS[use.name];
  const inputs: unknown[] = batchKey && Array.isArray(use.input[batchKey]) ? (use.input[batchKey] as unknown[]) : [use.input];
  const decision = toolDecision(use.name, aa);
  const out: Step[] = [];

  inputs.forEach((inp, i) => {
    stats.tool_use_items++;
    const item = items?.[i];
    const failed = isError || item?.success === false;
    const outcome: StepOutcome = failed ? "failed" : "ok";
    // Cline has no error type taxonomy; the message is all it gives.
    const error: StepError | undefined = failed && (item?.error ?? item?.result) ? { type: "cline_tool_error", message: item?.error ?? item?.result ?? "" } : undefined;
    const id = inputs.length > 1 || batchKey ? `${use.id}#${i}` : use.id;
    const resultText = item?.result;

    switch (use.name) {
      case "run_commands": {
        const payload: CommandPayload = {};
        const command = typeof inp === "string" ? inp : undefined;
        if (command !== undefined) payload.command = command;
        if (cwd) payload.cwd = cwd;
        let contentStatus: ContentStatus = "inline";
        if (resultText !== undefined) {
          const exit = EXIT_CODE_RE.exec(item?.error ?? "") ?? EXIT_CODE_RE.exec(resultText);
          if (exit) payload.exit_code = Number(exit[1]);
          if (PROCEED_RE.test(resultText)) {
            // Output side-channeled to a temp log ("proceed while running"). Pointer in output_ref.
            stats.proceed_while_running++;
            contentStatus = "reference_only";
            const log = PROCEED_LOG_RE.exec(resultText);
            if (log?.[1]) payload.output_ref = log[1];
            const partial = /Output so far:\n([\s\S]*)$/.exec(resultText);
            if (partial?.[1] !== undefined && partial[1].length > 0) payload.stdout = partial[1]; // partial output, see README
          } else {
            // Strip Cline's own "[Command exited with code N]" annotation line from stdout.
            payload.stdout = resultText.replace(/^\[Command exited with code \d+\]\n?/, "");
          }
        } else if (items === undefined) {
          contentStatus = "reference_only"; // no result at all
        }
        out.push({ ...base(id, at, segment, turnId, decision, outcome, contentStatus, error), type: "command", payload });
        return;
      }
      case "read_files": {
        const o = typeof inp === "object" && inp !== null ? (inp as Record<string, unknown>) : {};
        const payload: ReadPayload = { path: typeof o["path"] === "string" ? o["path"] : "" };
        const start = typeof o["start_line"] === "number" ? o["start_line"] : undefined;
        const end = typeof o["end_line"] === "number" ? o["end_line"] : undefined;
        if (start !== undefined && end !== undefined) payload.range = [start, end];
        out.push({ ...base(id, at, segment, turnId, decision, outcome, "inline", error), type: "read", payload });
        return;
      }
      case "editor": {
        const o = use.input;
        const oldText = typeof o["old_text"] === "string" ? o["old_text"] : undefined;
        const newText = typeof o["new_text"] === "string" ? o["new_text"] : undefined;
        const payload: EditPayload = {
          path: typeof o["path"] === "string" ? o["path"] : "",
          is_full_write: oldText === undefined, // create / full write when there is no old_text
        };
        if (oldText !== undefined) payload.old_string = oldText;
        if (newText !== undefined) payload.new_string = newText;
        // Cline returns a unified-diff snippet string, not a structured patch; structured_patch stays unset (see README).
        out.push({ ...base(id, at, segment, turnId, decision, outcome, "inline", error), type: "edit", payload });
        return;
      }
      default: {
        tally(stats.other_tool_names, use.name);
        const raw: Record<string, unknown> = { tool_use_id: use.id, input: inp };
        if (item !== undefined) raw["result"] = item;
        const payload: OtherPayload = { tool_name: use.name, raw };
        out.push({ ...base(id, at, segment, turnId, decision, outcome, items ? "inline" : "reference_only", error), type: "other", payload });
      }
    }
  });
  return out;
}

/**
 * PROVISIONAL: segments from checkpoint history. Each checkpoint carries a runCount
 * that increments per run of the session (1..4 in the real capture, across a
 * 15-hour span), which reads as a resume marker. Unverified against Cline source.
 */
function buildSegments(meta: ClineSessionInput["meta"], messages: ClineMessage[]): SessionSegment[] {
  const files = ["<id>.messages.json", "<id>.json"];
  const history = (meta?.metadata?.checkpoint?.history ?? []).filter((c) => typeof c.createdAt === "number").sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const endedAt = meta?.ended_at ?? iso(messages[messages.length - 1]?.ts);
  if (history.length === 0) {
    const seg: SessionSegment = { index: 0, start_reason: "start", started_at: meta?.started_at ?? iso(messages[0]?.ts), source_files: files };
    if (endedAt) seg.ended_at = endedAt;
    return [seg];
  }
  // Collapse checkpoints that share a runCount into one segment.
  const byRun = new Map<number, number>();
  for (const c of history) {
    const run = c.runCount ?? 1;
    if (!byRun.has(run)) byRun.set(run, c.createdAt ?? 0);
  }
  const runs = [...byRun.entries()].sort((a, b) => a[1] - b[1]);
  return runs.map(([run, startMs], i) => {
    const next = runs[i + 1];
    const seg: SessionSegment = {
      index: i,
      start_reason: i === 0 ? "start" : "resume", // PROVISIONAL: inferred from runCount
      started_at: i === 0 ? (meta?.started_at ?? iso(startMs)) : iso(startMs),
      source_files: files,
    };
    const end = next ? iso(next[1]) : endedAt;
    if (end) seg.ended_at = end;
    void run;
    return seg;
  });
}
