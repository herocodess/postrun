"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useLiveVersion } from "@/lib/live";
import type { SessionListResponse } from "@postrun/core/server/api";
import type { SessionSummary } from "@postrun/core/store";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: SessionListResponse };

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

function firstLine(s: string | undefined, max = 110): string {
  if (!s) return "";
  const line = s.split("\n")[0] ?? "";
  return line.length > max ? line.slice(0, max) + "…" : line;
}

function relativeTime(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const ms = now.getTime() - d.getTime();
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(ms / 86400000);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "now";
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const date = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${month}/${date.slice(-2)} ${hour}:${min}`;
}

function breakdownCounts(s: SessionSummary): React.ReactNode {
  if (s.steps_total === 0) return <span style={{ color: "var(--text-muted)" }}>nothing ran</span>;

  const entries = Object.entries(s.step_counts)
    .sort(([, a], [, b]) => b - a)
    .map(([t, n]) => `${n} ${t}`)
    .join(" · ");

  const parts: React.ReactNode[] = [entries];
  if (s.failed_count > 0) {
    parts.push(" · ");
    parts.push(
      <span key="failed" className="fail">
        {s.failed_count} failed
      </span>
    );
  }
  if (s.reference_only_count > 0) {
    parts.push(" · ");
    parts.push(
      <span key="ref" className="ref">
        {s.reference_only_count} ref
      </span>
    );
  }

  return parts;
}

export function SessionList() {
  const params = useSearchParams();
  const router = useRouter();
  const agent = params.get("agent") ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });
  // Bumps on any session write and on reconnect: the list refetches in place.
  const live = useLiveVersion();

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
        // A failed live refetch keeps what is on screen; the top bar already shows the server is offline.
        if (!cancelled) setState((prev) => (prev.kind === "ready" ? prev : { kind: "error", message: err instanceof Error ? err.message : String(err) }));
      });
    return () => {
      cancelled = true;
    };
  }, [agent, live]);

  if (state.kind === "loading") return <p>Loading…</p>;
  if (state.kind === "error")
    return <p className="error">Could not load sessions: {state.message}. Is the server running on 127.0.0.1:1234?</p>;

  const { sessions, agents } = state.data;
  const totalCost = sessions.reduce((sum, s) => sum + s.metrics.cost_usd, 0);

  return (
    <>
      <div className="head">
        <h1>Sessions</h1>
        <span className="sub">everything your agents did, on this machine</span>
      </div>

      <div className="filters">
        <span className="lbl">agent</span>
        <Link href="/" className={`chip ${agent === "" ? "on" : ""}`}>
          all
        </Link>
        {agents.map((a) => (
          <Link key={a} href={`/?agent=${encodeURIComponent(a)}`} className={`chip ${agent === a ? "on" : ""}`}>
            {a}
          </Link>
        ))}
        <span className="right">
          {sessions.length} session{sessions.length === 1 ? "" : "s"} &middot; <b>${totalCost.toFixed(2)}</b> total
        </span>
      </div>

      {sessions.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>No sessions in the store. Run: pnpm ingest --agent claude-code|cline &lt;source&gt;</p>
      ) : (
        <div className="list">
          {sessions.map((s) => (
            <Link key={s.id} href={`/session?id=${encodeURIComponent(s.id)}`} className="row">
              <div className="agent">
                <span className={`badge ${s.agent.kind === "cline" ? "cline" : "cc"}`}>{s.agent.kind}</span>
                <span className="ver">{s.agent.version}</span>
              </div>
              <div className="prompt">
                <div className="p">{firstLine(s.title) || "empty session · no activity captured"}</div>
                <div className="id">{s.id.slice(0, 8)}</div>
              </div>
              <div className="ws">{basename(s.workspace.root)}</div>
              <div className="when">
                {formatDate(s.started_at)} <span className="rel">· {relativeTime(s.started_at)}</span>
              </div>
              <div className="steps">
                <div className="n">{s.steps_total}</div>
                <div className="brk">{breakdownCounts(s)}</div>
              </div>
              <div className={`cost ${s.metrics.cost_usd === 0 ? "zero" : ""}`}>${s.metrics.cost_usd.toFixed(2)}</div>
              <div className={`flags ${s.flag_count > 0 ? "has" : ""}`}>{s.flag_count > 0 ? s.flag_count : "·"}</div>
            </Link>
          ))}
        </div>
      )}

      <div className="foot">
        postrun &middot; <span className="mono">local review</span> &middot; nothing leaves your machine
      </div>
    </>
  );
}
