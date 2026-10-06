/**
 * Where capture files live.
 *
 *   <captureDir>/spool/<time>-<pid>-<n>.ndjson  one hook event per file, written by the hook script
 *   <captureDir>/hooks.ndjson                 inbox: older hook scripts append here; the recorder routes it
 *   <captureDir>/sessions/<id>/hooks.ndjson   one session's hook events (routed from the inbox)
 *   <captureDir>/sessions/<id>/otlp-logs.ndjson  one session's telemetry (split by the receiver)
 *
 * One folder per session keeps every read proportional to that session, not
 * to all history, and lets a finished session's raw files be removed as a unit.
 * The hook writes each event to its own file and renames it into the spool,
 * which is atomic: two large events written at the same moment (parallel tool
 * calls, subagents) can no longer splice into each other the way concurrent
 * appends to one file did. The recorder routes the spool and the legacy inbox.
 *
 *   <captureDir>/.paused                      present while recording is paused: the hook drops events
 */

import { join } from "node:path";

export const INBOX_FILE = "hooks.ndjson";
export const SPOOL_DIR = "spool";
/** The rotated inbox while the recorder drains it. */
export const ROTATING_SUFFIX = ".routing";
export const ROUTER_STATE_FILE = ".router-state.json";
export const PAUSED_FILE = ".paused";
export const SESSION_HOOKS_FILE = "hooks.ndjson";
export const SESSION_OTLP_FILE = "otlp-logs.ndjson";

/** Session ids come from files other processes write: only plain tokens become path segments. */
export const SAFE_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export function isSafeId(id: unknown): id is string {
  return typeof id === "string" && SAFE_ID.test(id) && id !== "." && id !== "..";
}

export function sessionsDir(captureDir: string): string {
  return join(captureDir, "sessions");
}

export function sessionDir(captureDir: string, sessionId: string): string {
  if (!isSafeId(sessionId)) throw new Error(`unsafe session id ${JSON.stringify(sessionId)}`);
  return join(sessionsDir(captureDir), sessionId);
}

export function spoolDir(captureDir: string): string {
  return join(captureDir, SPOOL_DIR);
}
