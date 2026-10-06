"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useLiveVersion } from "@/lib/live";
import { api } from "@/lib/api";
import type { Step, Turn } from "@postrun/core/schema";
import type { SessionDetailResponse } from "@postrun/core/server/api";
import { summarize } from "@/lib/summarize";
import { ExportPanel } from "@/components/ExportPanel";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: SessionDetailResponse };

function firstLine(s: string | undefined, max = 160): string {
  if (!s) return "";
  const line = s.split("\n")[0] ?? "";
  return line.length > max ? line.slice(0, max) + "…" : line;
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const date = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${month}/${date.slice(-2)} ${hour}:${min}`;
}

export function Report() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [exporting, setExporting] = useState(false);
  // Bumps when this session is written (a running agent, a late hook record) and on reconnect.
  const live = useLiveVersion(id || undefined);

  useEffect(() => {
    if (!id) {
      setState({ kind: "error", message: "no session id in the URL (expected /session?id=...)" });
      return;
    }
    let cancelled = false;
    fetch(api.session(id))
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET /api/sessions/${id} -> ${res.status}`);
        return (await res.json()) as SessionDetailResponse;
      })
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((err: unknown) => {
        // A failed live refetch keeps what is on screen; the top bar already shows the server is offline.
        if (!cancelled) setState((prev) => (prev.kind === "ready" && prev.data.summary.id === id ? prev : { kind: "error", message: err instanceof Error ? err.message : String(err) }));
      });
    return () => {
      cancelled = true;
    };
  }, [id, live]);

  if (state.kind === "loading") return <p>Loading…</p>;
  if (state.kind === "error") return <p className="error">Could not load session: {state.message}</p>;

  const { summary, turns, steps, report, segments } = state.data;
  const stepsByTurn = new Map<string, Step[]>();
  for (const s of steps) {
    const list = stepsByTurn.get(s.turn_id) ?? [];
    list.push(s);
    stepsByTurn.set(s.turn_id, list);
  }
  const orphanTurns: Turn[] = [...stepsByTurn.keys()]
    .filter((tid) => !turns.some((t) => t.id === tid))
    .map((tid, i) => ({
      id: tid,
      session_id: summary.id,
      segment_index: 0,
      actor_id: "root",
      index: turns.length + i + 1,
      started_at: "",
      step_ids: [],
    }));

  return (
    <>
      {/* HERO */}
      <div className="hero">
        <div className="hero-glow"></div>
        <div className="hero-card">
          <div className="hero-top">
            <span className={`badge ${summary.agent.kind === "cline" ? "cline" : "cc"}`}>{summary.agent.kind}</span>
            <h1 className="title">{firstLine(summary.title, 140) || summary.id}</h1>
            <span className="ver">v{summary.agent.version}</span>
            <button type="button" className="btn" onClick={() => setExporting((v) => !v)} aria-expanded={exporting}>
              Export report
            </button>
          </div>

          <div className="stats">
            <div className="stat">
              <div className="k">cost</div>
              <div className="v mono">
                ${summary.metrics.cost_usd.toFixed(4)} <span className="sub">/ {summary.metrics.api_requests} req</span>
              </div>
            </div>
            <div className="stat">
              <div className="k">steps</div>
              <div className="v mono">{summary.steps_total}</div>
            </div>
            <div className="stat">
              <div className="k">turns</div>
              <div className="v mono">{turns.length}</div>
            </div>
            <div className="stat danger">
              <div className="k">failed</div>
              <div className="v mono">{summary.failed_count}</div>
            </div>
            <div className="stat warn">
              <div className="k">reference-only</div>
              <div className="v mono">{summary.reference_only_count}</div>
            </div>
          </div>

          <div className="meta-row">
            <span>
              workspace <b className="mono">{summary.workspace.root}</b>
            </span>
            <span>
              when <b className="mono">{formatDate(summary.started_at)} → {summary.ended_at ? formatDate(summary.ended_at) : "open"}</b> &middot; {segments.length} segment
              {segments.length === 1 ? "" : "s"}
            </span>
            <span>
              owner <b className="mono">{summary.owner_id}</b> on {summary.captured_on}
            </span>
            <span>
              tokens <b className="mono">{summary.metrics.tokens.input} in / {summary.metrics.tokens.output} out</b>
            </span>
          </div>
        </div>
      </div>

      {exporting && <ExportPanel sessionId={summary.id} onClose={() => setExporting(false)} />}

      {/* FILES TOUCHED */}
      <div className="sec">
        <div className="sec-h">
          <h2>Files touched</h2>
          <span className="count">
            {report.counts.files_touched} &middot; {report.counts.files_created} created, {report.counts.files_edited} edited, {report.counts.files_read} read
          </span>
        </div>
        {report.files.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No files were created, edited, or read.</p>
        ) : (
          <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>path</th>
                <th className="num">created</th>
                <th className="num">edited</th>
                <th className="num">read</th>
                <th className="num">failed</th>
              </tr>
            </thead>
            <tbody>
              {report.files.map((f) => (
                <tr key={f.path} className={f.failed ? "failed" : ""}>
                  <td className="path">{f.path}</td>
                  <td className={`num ${f.created > 0 ? "hit" : ""}`}>{f.created > 0 ? f.created : ""}</td>
                  <td className={`num ${f.edited > 0 ? "hit" : ""}`}>{f.edited > 0 ? f.edited : ""}</td>
                  <td className={`num ${f.read > 0 ? "hit" : ""}`}>{f.read > 0 ? f.read : ""}</td>
                  <td className={`fail-cell ${f.failed > 0 ? "" : ""}`}>{f.failed > 0 ? f.failed : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* COMMANDS RUN */}
      <div className="sec">
        <div className="sec-h">
          <h2>Commands run</h2>
          <span className="count">
            {report.counts.commands_run} &middot; {report.counts.commands_failed} failed, {report.counts.commands_reference_only} output not inline
          </span>
        </div>
        {report.commands.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No commands were run.</p>
        ) : (
          <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>command</th>
                <th className="num">runs</th>
                <th className="exit">exit</th>
              </tr>
            </thead>
            <tbody>
              {report.commands.map((c) => (
                <tr key={c.command + c.first_seq} className={c.failed ? "failed" : ""}>
                  <td className="cmd">
                    {firstLine(c.command)} {c.reference_only > 0 && <span className="tag ref">output not inline</span>}
                  </td>
                  <td className={`num ${c.count > 0 ? "hit" : ""}`}>{c.count}</td>
                  <td className={`exit ${c.failed > 0 ? "bad" : ""}`}>{c.exit_codes.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* TIMELINE */}
      <div className="sec">
        <div className="sec-h">
          <h2>Timeline</h2>
          <span className="count">
            {turns.length} turns &middot; {summary.steps_total} steps
          </span>
        </div>

        {[...turns, ...orphanTurns].map((t) => {
          const list = stepsByTurn.get(t.id) ?? [];
          const prompt = list.find((s) => s.type === "message" && s.payload.role === "user");
          const promptText = prompt && prompt.type === "message" ? prompt.payload.text : undefined;

          return (
            <div key={t.id} className="turn">
              <div className="turn-h">
                <span className="turn-n">turn {t.index}</span>
                <span className="txt">{firstLine(promptText || "", 120)}</span>
                <span className="mode">{t.mode || "no mode"}</span>
              </div>
              {list.map((s) => (
                <Step key={s.id} step={s} />
              ))}
            </div>
          );
        })}
      </div>

      <div className="foot">
        postrun &middot; <span className="mono">session {summary.id}</span> &middot; local review, nothing left your machine
      </div>
    </>
  );
}

function Step({ step }: { step: Step }) {
  const sum = summarize(step);

  let typeClass = "message";
  if (step.type === "command") typeClass = "command";
  else if (step.type === "edit") typeClass = "edit";
  else if (step.type === "read") typeClass = "read";

  let statusClass = "";
  let statusText = "ok";
  if (step.outcome === "failed") {
    statusClass = "fail";
    statusText = "failed";
    if (step.error) statusText += ` · ${step.error.type}`;
  } else if (sum.referenceOnly) {
    statusClass = "refonly";
    statusText = "reference-only";
  }

  return (
    <div className="step">
      <span className="st-seq">{step.seq}</span>
      <span className={`st-type ${typeClass}`}>{step.type}</span>
      <span className="st-body">{sum.text}</span>
      <span className={`st-status ${statusClass}`}>{statusText}</span>
    </div>
  );
}
