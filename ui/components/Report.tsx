"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Step, Turn } from "@postrun/core/schema";
import type { SessionDetailResponse } from "@postrun/core/server/api";
import { summarize } from "@/lib/summarize";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: SessionDetailResponse };

function firstLine(s: string | undefined, max = 160): string {
  if (!s) return "";
  const line = s.split("\n")[0] ?? "";
  return line.length > max ? line.slice(0, max) + "…" : line;
}

export function Report() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!id) {
      setState({ kind: "error", message: "no session id in the URL (expected /session?id=...)" });
      return;
    }
    let cancelled = false;
    fetch(`/api/sessions/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET /api/sessions/${id} -> ${res.status}`);
        return (await res.json()) as SessionDetailResponse;
      })
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

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
    .map((tid, i) => ({ id: tid, session_id: summary.id, segment_index: 0, actor_id: "root", index: turns.length + i + 1, started_at: "", step_ids: [] }));
  const modes = turns.reduce<Record<string, number>>((m, t) => {
    const k = t.mode ?? "(no mode)";
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});

  return (
    <article className="report">
      <header>
        <h1>
          <span className={`badge badge-${summary.agent.kind}`}>{summary.agent.kind}</span> {firstLine(summary.title, 120) || summary.id}
        </h1>
        <dl className="totals">
          <dt>session</dt>
          <dd>{summary.id}</dd>
          <dt>agent</dt>
          <dd id="agent">
            {summary.agent.kind} {summary.agent.version}
          </dd>
          <dt>workspace</dt>
          <dd>
            {summary.workspace.root}
            {summary.workspace.repo ? ` (${summary.workspace.repo})` : ""}
          </dd>
          <dt>when</dt>
          <dd>
            {summary.started_at} → {summary.ended_at ?? "open"} · {segments.length} segment{segments.length === 1 ? "" : "s"}
          </dd>
          <dt>owner</dt>
          <dd>
            {summary.owner_id} on {summary.captured_on}
          </dd>
          <dt>steps</dt>
          <dd id="step-count">
            {summary.steps_total} · {summary.failed_count} failed · {summary.reference_only_count} reference-only · {summary.flag_count} flags
          </dd>
          <dt>turns</dt>
          <dd id="turn-count">
            {turns.length} (
            {Object.entries(modes)
              .map(([m, n]) => `${m} ${n}`)
              .join(", ")}
            )
          </dd>
          <dt>cost</dt>
          <dd>
            ${summary.metrics.cost_usd.toFixed(4)} over {summary.metrics.api_requests} API requests · tokens in {summary.metrics.tokens.input}, out {summary.metrics.tokens.output}, cache read{" "}
            {summary.metrics.tokens.cache_read}, cache create {summary.metrics.tokens.cache_creation}
          </dd>
        </dl>
      </header>

      <section id="files">
        <h2>
          Files touched <span className="muted">({report.counts.files_touched}: {report.counts.files_created} created, {report.counts.files_edited} edited, {report.counts.files_read} read)</span>
        </h2>
        {report.files.length === 0 ? (
          <p className="muted">No files were created, edited, or read.</p>
        ) : (
          <table className="summary-table">
            <thead>
              <tr>
                <th>path</th>
                <th>created</th>
                <th>edited</th>
                <th>read</th>
                <th>failed</th>
              </tr>
            </thead>
            <tbody>
              {report.files.map((f) => (
                <tr key={f.path} className={f.created + f.edited > 0 ? "written" : ""}>
                  <td className="mono">{f.path}</td>
                  <td>{f.created || ""}</td>
                  <td>{f.edited || ""}</td>
                  <td>{f.read || ""}</td>
                  <td className={f.failed ? "failed-cell" : ""}>{f.failed || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section id="commands">
        <h2>
          Commands run{" "}
          <span className="muted">
            ({report.counts.commands_run}: {report.counts.commands_failed} failed, {report.counts.commands_reference_only} output not inline)
          </span>
        </h2>
        {report.commands.length === 0 ? (
          <p className="muted">No commands were run.</p>
        ) : (
          <table className="summary-table">
            <thead>
              <tr>
                <th>command</th>
                <th>runs</th>
                <th>failed</th>
                <th>exit</th>
                <th>output</th>
              </tr>
            </thead>
            <tbody>
              {report.commands.map((c) => (
                <tr key={c.command + c.first_seq} className={c.failed ? "failed" : ""}>
                  <td className="mono">{c.command === "(command not inline)" ? <span className="ref-only">{c.command}</span> : firstLine(c.command)}</td>
                  <td>{c.count}</td>
                  <td className={c.failed ? "failed-cell" : ""}>{c.failed || ""}</td>
                  <td>{c.exit_codes.join(", ")}</td>
                  <td>{c.reference_only ? <span className="ref-only">{c.reference_only} not inline</span> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section id="timeline">
        <h2>Timeline by turn</h2>
        {[...turns, ...orphanTurns].map((t) => {
          const list = stepsByTurn.get(t.id) ?? [];
          const prompt = list.find((s) => s.type === "message" && s.payload.role === "user");
          const promptText = prompt && prompt.type === "message" ? prompt.payload.text : undefined;
          const failed = list.filter((s) => s.outcome === "failed").length;
          return (
            <details key={t.id} className="turn" open data-turn-id={t.id}>
              <summary>
                <b>Turn {t.index}</b>
                {t.mode ? <span className="badge badge-mode">{t.mode}</span> : null} <span className="muted">{t.started_at}</span> · {list.length} steps
                {failed ? <span className="failed-cell"> · {failed} failed</span> : null}
                {promptText ? <span className="prompt"> — {firstLine(promptText, 140)}</span> : null}
              </summary>
              <table className="timeline">
                <thead>
                  <tr>
                    <th>seq</th>
                    <th>type</th>
                    <th>summary</th>
                    <th>decision</th>
                    <th>outcome</th>
                  </tr>
                </thead>
                <tbody>{list.map((s) => <Row key={s.id} step={s} />)}</tbody>
              </table>
            </details>
          );
        })}
      </section>
    </article>
  );
}

function Row({ step }: { step: Step }) {
  const sum = summarize(step);
  return (
    <tr className={step.outcome} data-seq={step.seq} data-type={step.type} data-reference-only={String(sum.referenceOnly)}>
      <td className="seq">{step.seq}</td>
      <td className="type">{step.type}</td>
      <td className="summary">
        {sum.referenceOnly ? <span className="ref-only">{sum.text}</span> : sum.text}
        {sum.ref ? <div className="ref-path">{(sum.referenceOnly ? "ref: " : "output persisted: ") + sum.ref}</div> : null}
        {step.error ? (
          <div className="error small">
            {step.error.type}: {firstLine(step.error.message, 200)}
          </div>
        ) : null}
        <details>
          <summary className="muted small">payload · channels: {step.channels.join(", ")}</summary>
          <pre>{JSON.stringify(step.payload, null, 2)}</pre>
        </details>
      </td>
      <td className="decision">{step.decision}</td>
      <td className="status">{step.outcome === "failed" ? "FAILED" : step.outcome}</td>
    </tr>
  );
}
