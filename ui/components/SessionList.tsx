"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { SessionListResponse } from "@postrun/core/server/api";
import type { SessionSummary } from "@postrun/core/store";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: SessionListResponse };

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

function firstLine(s: string | undefined, max = 110): string {
  if (!s) return "(no prompt text)";
  const line = s.split("\n")[0] ?? "";
  return line.length > max ? line.slice(0, max) + "…" : line;
}

function counts(s: SessionSummary): string {
  return Object.entries(s.step_counts)
    .sort(([, a], [, b]) => b - a)
    .map(([t, n]) => `${n} ${t}`)
    .join(", ");
}

export function SessionList() {
  const params = useSearchParams();
  const router = useRouter();
  const agent = params.get("agent") ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const q = agent ? `?agent=${encodeURIComponent(agent)}` : "";
    fetch(`/api/sessions${q}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET /api/sessions -> ${res.status}`);
        return (await res.json()) as SessionListResponse;
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
  }, [agent]);

  if (state.kind === "loading") return <p>Loading…</p>;
  if (state.kind === "error") return <p className="error">Could not load sessions: {state.message}. Is the server running on 127.0.0.1:1234?</p>;

  const { sessions, agents } = state.data;
  return (
    <>
      <p className="filter" id="agent-filter">
        agent:{" "}
        <Link href="/" className={agent === "" ? "active" : ""}>
          all
        </Link>
        {agents.map((a) => (
          <span key={a}>
            {" · "}
            <Link href={`/?agent=${encodeURIComponent(a)}`} className={agent === a ? "active" : ""}>
              {a}
            </Link>
          </span>
        ))}
        <span className="muted"> ({sessions.length} session{sessions.length === 1 ? "" : "s"})</span>
      </p>
      {sessions.length === 0 ? (
        <p className="muted">No sessions in the store. Run: pnpm ingest --agent claude-code|cline &lt;source&gt;</p>
      ) : (
        <table className="sessions" id="sessions">
          <thead>
            <tr>
              <th>agent</th>
              <th>workspace</th>
              <th>prompt</th>
              <th>started</th>
              <th>steps</th>
              <th>cost</th>
              <th>flags</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} data-session-id={s.id} data-agent={s.agent.kind} className="session-row" onClick={() => router.push(`/session?id=${encodeURIComponent(s.id)}`)}>
                <td>
                  <span className={`badge badge-${s.agent.kind}`}>{s.agent.kind}</span>
                  <div className="muted small">{s.agent.version}</div>
                </td>
                <td title={s.workspace.root}>{basename(s.workspace.root)}</td>
                <td>
                  <Link href={`/session?id=${encodeURIComponent(s.id)}`} onClick={(e) => e.stopPropagation()}>
                    {firstLine(s.title)}
                  </Link>
                  <div className="muted small">{s.id}</div>
                </td>
                <td className="nowrap">{s.started_at.replace("T", " ").replace(/\.\d+Z$/, "Z")}</td>
                <td>
                  {s.steps_total}
                  <div className="muted small">{counts(s)}</div>
                  <div className="muted small">
                    {s.turn_count} turns · {s.failed_count} failed · {s.reference_only_count} ref-only
                  </div>
                </td>
                <td className="nowrap">${s.metrics.cost_usd.toFixed(4)}</td>
                <td>{s.flag_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
