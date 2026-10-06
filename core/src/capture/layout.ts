/**
 * Where capture files live.
 *
 *   <captureDir>/hooks.ndjson                 inbox: the hook script appends every event here
 *   <captureDir>/sessions/<id>/hooks.ndjson   one session's hook events (routed from the inbox)
 *   <captureDir>/sessions/<id>/otlp-logs.ndjson  one session's telemetry (split by the receiver)
 *
 * One folder per session keeps every read proportional to that session, not
 * to all history, and lets a finished session's raw files be removed as a unit.
 * The inbox stays a single append-only file so the hook script is trivial and
 * never slows Claude Code down; the recorder routes it and rotates it.
 */

import { join } from "node:path";

export const INBOX_FILE = "hooks.ndjson";
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
