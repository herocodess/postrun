/**
 * Hook channel reader (hooks.ndjson).
 *
 * Per the v1.1 content-source rule the hook is the PRIMARY content source:
 * full tool_input, full tool_response.stdout, full prompt text.
 *
 * Known shape facts (measured):
 * - hooks.ndjson interleaves many sessions; always filter by session_id.
 * - Records carry no event timestamp, only the wrapper received_at at
 *   whole-second resolution.
 * - PostToolUseFailure records have no tool_response; the failure text is in
 *   `error`.
 */

export type HookEventName =
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Stop"
  | (string & {});

export interface HookPayload {
  session_id: string;
  hook_event_name: HookEventName;
  transcript_path?: string;
  cwd?: string;
  scratchpad_dir?: string;
  prompt_id?: string;
  permission_mode?: string;
  // SessionStart / SessionEnd
  source?: string;
  model?: string;
  reason?: string;
  // UserPromptSubmit
  prompt?: string;
  // Tool events
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  tool_use_id?: string;
  duration_ms?: number;
  error?: string;
  is_interrupt?: boolean;
  // Stop
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  [key: string]: unknown;
}

export interface HookRecord {
  received_at: string;
  channel: "hook" | (string & {});
  payload: HookPayload;
}

export function isHookRecord(x: unknown): x is HookRecord {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Partial<HookRecord>;
  return (
    typeof r.received_at === "string" &&
    typeof r.payload === "object" &&
    r.payload !== null &&
    typeof (r.payload as Partial<HookPayload>).session_id === "string" &&
    typeof (r.payload as Partial<HookPayload>).hook_event_name === "string"
  );
}

/** Bash tool_response as observed on PostToolUse hooks. */
export interface BashHookResponse {
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
  isImage?: boolean;
  noOutputExpected?: boolean;
  returnCodeInterpretation?: string;
  persistedOutputPath?: string;
  persistedOutputSize?: number;
  gitOperation?: unknown;
}

/** Edit tool_response as observed on PostToolUse hooks. */
export interface EditHookResponse {
  filePath?: string;
  oldString?: string;
  newString?: string;
  originalFile?: string;
  structuredPatch?: unknown;
  userModified?: boolean;
  replaceAll?: boolean;
}

export function asObject(x: unknown): Record<string, unknown> | undefined {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined;
}

export function asString(x: unknown): string | undefined {
  return typeof x === "string" ? x : undefined;
}

export function asNumber(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}
