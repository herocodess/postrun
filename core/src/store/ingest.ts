/**
 * Adapter output -> SessionRecord -> store. One function per adapter.
 */

import { readCaptureDir, type LoadedCapture } from "../adapters/claude-code/index.js";
import { adaptCline, loadClineSession } from "../adapters/cline/index.js";
import { turnsFromSteps } from "../adapters/turns.js";
import type { SessionRecord } from "./types.js";

/**
 * Build a SessionRecord from a Claude Code captures directory. Pass `loaded`
 * (from loadCaptureDir) to build many sessions from one read of the files.
 * A session recorded from hooks alone has no API metrics, so cost and tokens are zero.
 */
export function claudeCodeRecord(capturesDir: string, sessionId?: string, loaded?: LoadedCapture): SessionRecord {
  const r = readCaptureDir(capturesDir, sessionId, loaded);
  const first = r.segments[0];
  const last = r.segments[r.segments.length - 1];
  const record: SessionRecord = {
    id: r.session_id,
    agent: { kind: "claude-code", version: r.stats.agent_version ?? "unknown" },
    workspace: { root: r.stats.cwd ?? workspaceRootFromSteps(r.steps) },
    started_at: first?.started_at ?? r.steps[0]?.at ?? "",
    segments: r.segments,
    actors: [{ id: "root", type: "root" }],
    turns: turnsFromSteps(r.steps, r.session_id),
    steps: r.steps,
    metrics: r.stats.totals,
    source: capturesDir,
  };
  if (last?.ended_at) record.ended_at = last.ended_at;
  return record;
}

/** Build a SessionRecord from a Cline session id, directory, or messages file. */
export function clineRecord(idOrPath: string): SessionRecord {
  const r = adaptCline(loadClineSession(idOrPath));
  const first = r.segments[0];
  const last = r.segments[r.segments.length - 1];
  const record: SessionRecord = {
    id: r.session_id,
    agent: r.agent,
    workspace: r.workspace,
    started_at: first?.started_at ?? r.steps[0]?.at ?? "",
    segments: r.segments,
    actors: r.actors,
    turns: r.turns,
    steps: r.steps,
    metrics: r.stats.totals.from_metrics,
    source: idOrPath,
  };
  if (last?.ended_at) record.ended_at = last.ended_at;
  return record;
}

/** Claude Code steps carry cwd on command payloads; the most common one is the workspace root. */
function workspaceRootFromSteps(steps: SessionRecord["steps"]): string {
  const counts = new Map<string, number>();
  for (const s of steps) {
    if (s.type === "command" && s.payload.cwd) counts.set(s.payload.cwd, (counts.get(s.payload.cwd) ?? 0) + 1);
  }
  let best = "";
  let n = 0;
  for (const [cwd, c] of counts) if (c > n) [best, n] = [cwd, c];
  return best;
}
