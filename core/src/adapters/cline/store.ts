/**
 * Cline session store reader (Cline 4.1.x, current format).
 *
 * Location (decoded 2026-09-07):
 *   ~/.cline/data/sessions/<id>/<id>.messages.json   the conversation (single JSON document)
 *   ~/.cline/data/sessions/<id>/<id>.json            session metadata (cwd, model, checkpoints, totals)
 *   ~/.cline/data/db/sessions.db                     SQLite index; one row per session, points at messages_path
 *   ~/.cline/data/globalState.json                   settings, including autoApprovalSettings
 *
 * The VS Code globalStorage task directories (api_conversation_history.json,
 * ui_messages.json) are the LEGACY format and are not read here.
 *
 * Read only. Never writes to any of these files.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

// ---- messages file ----------------------------------------------------------

export interface ClineTextBlock {
  type: "text";
  text: string;
}
export interface ClineThinkingBlock {
  type: "thinking";
  thinking: string;
}
export interface ClineToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ClineToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  /** Array of result items for batched tools; a JSON string for the editor tool. */
  content: unknown;
  is_error?: boolean;
}
export type ClineBlock = ClineTextBlock | ClineThinkingBlock | ClineToolUseBlock | ClineToolResultBlock | { type: string };

export interface ClineMetrics {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
}

export interface ClineMessage {
  id: string;
  role: "user" | "assistant";
  content: ClineBlock[];
  ts: number; // epoch ms. NOT reliably monotonic (5 of 151 go backwards in the real session).
  modelInfo?: { id?: string; provider?: string };
  metrics?: ClineMetrics;
}

export interface ClineMessagesDoc {
  version: number;
  updated_at?: string;
  agent?: string; // "lead" observed
  sessionId: string;
  origin?: { source?: string; mode?: string; sessionId?: string; version?: string };
  system_prompt?: string;
  messages: ClineMessage[];
}

/** One item of a batched tool result (run_commands, read_files, search_codebase, fetch_web_content, editor). */
export interface ClineResultItem {
  query?: string; // may be truncated for commands; use the tool_use input instead
  result?: string;
  success?: boolean;
  error?: string;
}

// ---- metadata file ----------------------------------------------------------

export interface ClineCheckpoint {
  ref?: string;
  createdAt?: number;
  runCount?: number;
  kind?: string;
}

export interface ClineSessionMeta {
  version?: number;
  session_id: string;
  source?: string;
  started_at?: string;
  ended_at?: string;
  exit_code?: number;
  status?: string;
  provider?: string;
  model?: string;
  cwd?: string;
  workspace_root?: string;
  enable_spawn?: boolean;
  enable_teams?: boolean;
  prompt?: string;
  metadata?: {
    sessionHistoryOrigin?: { mode?: string; version?: string };
    git?: { url?: string; branch?: string };
    checkpoint?: { latest?: ClineCheckpoint; history?: ClineCheckpoint[] };
    title?: string;
    totalCost?: number;
    tokensIn?: number;
    tokensOut?: number;
    cacheWrites?: number;
    cacheReads?: number;
    modelId?: string;
    legacyTask?: boolean;
    usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalCost?: number };
  };
  messages_path?: string;
}

// ---- auto-approval settings (globalState.json) --------------------------------

export interface ClineAutoApproval {
  enabled?: boolean;
  actions?: {
    readFiles?: boolean;
    editFiles?: boolean;
    executeSafeCommands?: boolean;
    executeAllCommands?: boolean;
    useBrowser?: boolean;
    useMcp?: boolean;
  };
}

// ---- locating and loading -----------------------------------------------------

export interface ClineSessionFiles {
  session_id: string;
  messages_path: string;
  meta_path?: string;
  global_state_path?: string;
}

export function defaultClineDataDir(): string {
  return join(homedir(), ".cline", "data");
}

/**
 * Resolve a session id, a session directory, or a messages file path to the files to read.
 */
export function locateClineSession(idOrPath: string, dataDir = defaultClineDataDir()): ClineSessionFiles {
  let messagesPath: string | undefined;
  const asPath = resolve(idOrPath);
  if (existsSync(asPath)) {
    const st = statSync(asPath);
    if (st.isFile()) {
      messagesPath = asPath;
    } else if (st.isDirectory()) {
      const candidate = readdirSync(asPath).find((f) => f.endsWith(".messages.json"));
      if (!candidate) throw new Error(`no *.messages.json in ${asPath}`);
      messagesPath = join(asPath, candidate);
    }
  }
  if (!messagesPath) {
    const dir = join(dataDir, "sessions", idOrPath);
    const candidate = join(dir, `${idOrPath}.messages.json`);
    if (!existsSync(candidate)) throw new Error(`Cline session ${idOrPath} not found (looked for ${candidate})`);
    messagesPath = candidate;
  }
  const sessionId = basename(messagesPath).replace(/\.messages\.json$/, "");
  const metaPath = join(dirname(messagesPath), `${sessionId}.json`);
  const files: ClineSessionFiles = { session_id: sessionId, messages_path: messagesPath };
  if (existsSync(metaPath)) files.meta_path = metaPath;
  // globalState.json sits two levels above sessions/<id>/ in the standard layout.
  const gsCandidates = [join(dataDir, "globalState.json"), join(dirname(messagesPath), "..", "..", "globalState.json")];
  const gs = gsCandidates.find((p) => existsSync(p));
  if (gs) files.global_state_path = resolve(gs);
  return files;
}

export interface ClineSessionInput {
  doc: ClineMessagesDoc;
  meta?: ClineSessionMeta;
  autoApproval?: ClineAutoApproval;
  files: ClineSessionFiles;
}

export function loadClineSession(idOrPath: string, dataDir?: string): ClineSessionInput {
  const files = locateClineSession(idOrPath, dataDir);
  const doc = JSON.parse(readFileSync(files.messages_path, "utf8")) as ClineMessagesDoc;
  if (!Array.isArray(doc.messages)) throw new Error(`${files.messages_path} has no messages array`);
  const input: ClineSessionInput = { doc, files };
  if (files.meta_path) input.meta = JSON.parse(readFileSync(files.meta_path, "utf8")) as ClineSessionMeta;
  if (files.global_state_path) {
    const gs = JSON.parse(readFileSync(files.global_state_path, "utf8")) as { autoApprovalSettings?: ClineAutoApproval };
    if (gs.autoApprovalSettings) input.autoApproval = gs.autoApprovalSettings;
  }
  return input;
}

export function isToolUse(b: ClineBlock): b is ClineToolUseBlock {
  return b.type === "tool_use";
}
export function isToolResult(b: ClineBlock): b is ClineToolResultBlock {
  return b.type === "tool_result";
}
export function isText(b: ClineBlock): b is ClineTextBlock {
  return b.type === "text";
}
export function isThinking(b: ClineBlock): b is ClineThinkingBlock {
  return b.type === "thinking";
}
