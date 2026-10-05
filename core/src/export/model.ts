/**
 * Turns a stored session into what may leave the machine: redacted, and
 * stripped of fields that only make sense locally.
 *
 * Kept: agent, workspace (redacted), times, API metrics, turns, steps
 * (redacted), and report projections recomputed from the redacted steps.
 * Dropped: owner_id, captured_on (machine name), source (local capture
 * paths), verdict (a private review note), and segment source_files.
 */

import type { AgentInfo, Step, Turn, Workspace } from "../schema/index.js";
import { createRedactor, redactDeep, type RedactionReport } from "../redact/redact.js";
import { sessionReport, type SessionReport } from "../report/index.js";
import type { SessionMetrics, StoredSession } from "../store/index.js";

export interface ExportDocument {
  session_id: string;
  title?: string;
  agent: AgentInfo;
  workspace: Workspace;
  started_at: string;
  ended_at?: string;
  /** Last step time when the session has no end, for an honest duration. */
  last_activity_at?: string;
  segment_count: number;
  metrics: SessionMetrics;
  turns: Turn[];
  steps: Step[];
  report: SessionReport;
  exported_at: string;
}

export interface ExportResult {
  doc: ExportDocument;
  redaction: RedactionReport;
}

export function buildExport(session: StoredSession, opts: { now?: Date } = {}): ExportResult {
  const r = createRedactor();
  const { summary } = session;

  const steps: Step[] = session.steps.map((s) => {
    const where = `step ${s.seq} · ${s.type}`;
    const before = r.report().findings.length;
    const payload = redactDeep(s.payload, r, where);
    const out = { ...s, payload } as Step;
    if (s.error) out.error = { type: r.string(s.error.type, `${where} · error`), message: r.string(s.error.message, `${where} · error`) };
    const found = r.report().findings.length - before;
    if (found > 0) {
      out.flags = [
        ...s.flags.map((f) => ({ ...f, reason: r.string(f.reason, `${where} · flag`) })),
        { kind: "secret_in_output", severity: "warn", reason: `${found} value${found === 1 ? "" : "s"} redacted on export` },
      ];
    } else {
      out.flags = s.flags.map((f) => ({ ...f, reason: r.string(f.reason, `${where} · flag`) }));
    }
    return out;
  });

  const workspace: Workspace = { root: r.string(summary.workspace.root, "workspace") };
  if (summary.workspace.repo !== undefined) workspace.repo = r.string(summary.workspace.repo, "workspace");

  // Title from the redacted steps, never from the stored (unredacted) summary.
  const firstUser = steps.find((s) => s.type === "message" && s.payload.role === "user" && s.payload.text);
  const title = firstUser?.type === "message" ? firstUser.payload.text?.split("\n")[0]?.slice(0, 200) : undefined;

  const turns: Turn[] = session.turns.map((t) => ({ ...t, ...(t.mode !== undefined ? { mode: r.string(t.mode, `turn ${t.index}`) } : {}) }));
  const lastAt = steps.length ? steps.reduce((m, s) => (s.at > m ? s.at : m), steps[0]!.at) : undefined;

  const doc: ExportDocument = {
    session_id: summary.id,
    agent: summary.agent,
    workspace,
    started_at: summary.started_at,
    segment_count: session.segments.length,
    metrics: summary.metrics,
    turns,
    steps,
    report: sessionReport(steps),
    exported_at: (opts.now ?? new Date()).toISOString(),
  };
  if (title) doc.title = title;
  if (summary.ended_at !== undefined) doc.ended_at = summary.ended_at;
  else if (lastAt !== undefined) doc.last_activity_at = lastAt;
  return { doc, redaction: r.report() };
}
