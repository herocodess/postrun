/**
 * Postrun v1.2 Event Schema
 *
 * Type definitions for session capture, normalized from agent-specific formats.
 * All timestamps are ISO 8601 strings. Costs and tokens are parsed numbers.
 */

// Named union types for strict enums with escape hatch for unmapped values
export type FlagKind =
  | "dangerous_command"
  | "dead_end_edit"
  | "rejected"
  | "failed"
  | "secret_in_output"
  | (string & {}); // escape hatch for unmapped values

export type VerdictState =
  | "reviewed"
  | "approved"
  | "needs_attention"
  | (string & {}); // escape hatch for unmapped values

export type CaptureChannelName =
  | "otel"
  | "trace"
  | "hook"
  | "transcript"
  | (string & {}); // escape hatch for unmapped values

export type AgentKind =
  | "claude-code"
  | "cline"
  | (string & {}); // escape hatch for unmapped values

export type ActorType = "root" | "subagent" | (string & {});

// v1.2 A4: the old single `status` split into a permission decision and an execution outcome
export type StepDecision = "accepted" | "rejected" | "auto" | "n/a" | (string & {});
export type StepOutcome = "ok" | "failed" | (string & {});

// v1.2 A2: whether payload content is inline or only a pointer (*_ref)
export type ContentStatus = "inline" | "reference_only";

// v1.2 A3: agent-reported failure reason; optional because not every failure carries one
export interface StepError {
  type: string; // e.g. error_type from the hook/otlp ("Error:EISDIR", "ShellError", MCP error kinds)
  message: string;
}

// Actor: entity that took a step
// UNVERIFIED: agent_id/parent_agent_id fields; no subagent spawning captured yet
export interface Actor {
  id: string;
  parent_id?: string; // undefined for root
  type: ActorType; // UNVERIFIED: shape may change with real subagent data
  label?: string;
}

// Flags on steps for dangerous commands, dead-end edits, rejections, etc.
export interface Flag {
  kind: FlagKind;
  severity: "info" | "warn" | "danger";
  reason: string;
}

// Verdict: manual review outcome
export interface Verdict {
  state: VerdictState;
  note?: string;
  reviewer?: string;
}

// Command: shell command execution
export interface CommandPayload {
  command?: string; // absent with content_status "reference_only" when the command survives only in the transcript (A2)
  stdout?: string; // from HOOK (full content); traces fallback. otlp-logs never used here. Capped at 30000 chars; overflow in output_ref.
  stderr?: string;
  exit_code?: number; // parsed from string
  cwd?: string;
  output_ref?: string; // pointer when side-channeled or missing inline
}

// Edit: file modification
export interface EditPayload {
  path: string;
  old_string?: string; // full in hook; otlp-logs truncates
  new_string?: string;
  structured_patch?: unknown; // v1.2 A5: the hook's own structured diff (plus originalFile, userModified when present)
  is_full_write: boolean;
  landed_in_final_state?: boolean; // PROJECTION, not captured: false marks a dead-end edit. Adapters never set it.
}

// Read: file read
export interface ReadPayload {
  path: string;
  range?: [number, number]; // [start_line, end_line]
}

// Message: user/assistant message
export interface MessagePayload {
  role: string; // e.g. "user" | "assistant"
  text?: string;
  text_ref?: string; // pointer when side-channeled or missing inline
}

// Other: catch-all for unmodeled tools
export interface OtherPayload {
  tool_name: string;
  raw: Record<string, unknown>;
}

// Step base: common fields for all step types
interface StepBase {
  id: string;
  session_id: string;
  segment_index: number; // which SessionSegment this step belongs to
  turn_id: string;
  actor_id: string; // UNVERIFIED source; defaults to root actor
  seq: number; // Claude Code: event.sequence (already an int). Gapless per session.
  at: string; // timestamp (ISO 8601)
  decision: StepDecision; // v1.2 A4: permission decision. "n/a" for non-tool steps.
  outcome: StepOutcome; // v1.2 A4: execution result.
  content_status: ContentStatus; // v1.2 A2: "reference_only" means content fields are absent and a *_ref carries the pointer.
  error?: StepError; // v1.2 A3: present when outcome is "failed" and the agent reported a reason.
  channels: string[]; // e.g. ["hook", "trace"]. Indicates which channels provided content.
  flags: Flag[];
}

// Step: discriminated union on type field. Enables type narrowing:
// if (step.type === "command") { step.payload.command ... }
export type Step =
  | (StepBase & { type: "command"; payload: CommandPayload })
  | (StepBase & { type: "edit"; payload: EditPayload })
  | (StepBase & { type: "read"; payload: ReadPayload })
  | (StepBase & { type: "message"; payload: MessagePayload })
  | (StepBase & { type: "other"; payload: OtherPayload });

// Turn: container of steps (one assistant turn)
export interface Turn {
  id: string;
  session_id: string;
  segment_index: number; // turns belong to a segment
  actor_id: string; // UNVERIFIED source
  index: number;
  prompt_id?: string; // Claude Code: prompt.id
  mode?: string; // PROVISIONAL (Cline plan|act). Not normalized in v1.x
  started_at: string; // timestamp (ISO 8601)
  step_ids: string[];
}

// SessionSegment: contiguous run within a session (session resume support)
export interface SessionSegment {
  index: number;
  start_reason: string; // e.g. "start" | "resume" | "clear"
  started_at: string; // timestamp (ISO 8601)
  ended_at?: string; // timestamp (ISO 8601)
  source_files: string[]; // which capture files this segment's events came from
}

// CaptureChannel: coverage info per channel per segment
export interface CaptureChannel {
  name: CaptureChannelName;
  segment_index: number; // which segment this coverage window applies to
  active_from?: string; // timestamp (ISO 8601)
  active_to?: string; // timestamp (ISO 8601)
  shared_file: boolean; // true if file also holds other sessions
  notes?: string; // e.g. "registered mid-session", "backfilled", "resumed"
}

// CaptureCoverage: channel coverage tracking
export interface CaptureCoverage {
  channels: CaptureChannel[];
}

// Agent metadata
export interface AgentInfo {
  kind: AgentKind;
  version: string;
  format_version?: string; // PROVISIONAL (Cline "legacy" vs current store)
}

// Workspace context
export interface Workspace {
  root: string;
  repo?: string; // optional repo identifier
}

// Token usage
export interface TokenUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
}

// Step counts by type
export interface StepCounts {
  by_type: Record<string, number>;
}

// Totals: aggregated metrics across all segments
export interface SessionTotals {
  cost_usd: number; // parsed from string api_request attrs
  tokens: TokenUsage;
  step_counts: StepCounts;
  flags: number;
}

// Session: one run of one agent against one working directory
export interface Session {
  id: string; // Postrun-assigned, maps to agent's own id
  agent: AgentInfo;
  workspace: Workspace;
  segments: SessionSegment[]; // session is now a list of segments (resume support)
  actors: Actor[]; // UNVERIFIED: tree structure
  capture: CaptureCoverage;
  totals: SessionTotals; // projected from steps across all segments
  verdict?: Verdict;
}
