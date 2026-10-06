"use client";

/**
 * The dashboard: what agents did in a period, what is running now, what needs
 * a look, and the files they changed most. One request (GET /api/dashboard),
 * refreshed live.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Dashboard as DashboardData, DashboardTotals } from "@postrun/core/server/api";
import type { SessionSummary } from "@postrun/core/store";
import { EmptySessions } from "@/components/EmptySessions";
import { Strip, stripOf } from "@/components/Strip";
import { api, DEMO } from "@/lib/api";
import { useLiveVersion } from "@/lib/live";
import { CountUp, stagger } from "@/lib/motion";

type Days = 1 | 7 | 30;
const PERIODS: Array<[Days, string]> = [
  [1, "Today"],
  [7, "7 days"],
  [30, "30 days"],
];
const KINDS = ["command", "edit", "read", "message", "other", "failed"] as const;
type Kind = (typeof KINDS)[number];

const n = (x: number) => x.toLocaleString();
const firstLine = (s?: string) => (s ? (s.split("\n")[0] ?? "").slice(0, 120) : "");
const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;
const agentName = (k: string) => (k === "claude-code" ? "Claude Code" : k === "cline" ? "Cline" : k);
const href = (s: SessionSummary) => `/session?id=${encodeURIComponent(s.id)}`;

function compare(cur: number, prev: number, unit: string): string {
  if (prev === 0) return cur === 0 ? "none in the period before either" : "none in the period before";
  const diff = cur - prev;
  if (diff === 0) return "the same as the period before";
  return `${n(Math.abs(diff))} ${diff > 0 ? "more" : "fewer"} ${unit} than the period before`;
}

function dayLabel(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00`);
  return days <= 7 ? d.toLocaleDateString([], { weekday: "short" }) : String(d.getDate());
}

function Spark({ values, tone }: { values: number[]; tone: "plain" | "danger" }) {
  const max = Math.max(1, ...values);
  return (
    <span className={`spark spark-${tone}`} aria-hidden="true">
      {values.map((v, i) => (
        <span key={i} style={{ height: `${Math.max(8, (v / max) * 100)}%`, ["--i" as string]: i }} className={i === values.length - 1 ? "last" : ""}></span>
      ))}
    </span>
  );
}

function Figures({ d }: { d: DashboardData }) {
  const t: DashboardTotals = d.totals;
  const p = d.previous;
  const per = d.per_day;
  const items = [
    { label: "Sessions", value: t.sessions, note: compare(t.sessions, p.sessions, "sessions"), spark: per.map((x) => x.sessions), tone: "plain" as const, to: "/sessions" },
    { label: "Steps", value: t.steps, note: "commands, edits, reads and replies", spark: per.map((x) => x.command + x.edit + x.read + x.message + x.other + x.failed), tone: "plain" as const, to: "/sessions" },
    {
      label: "Failed steps",
      value: t.failed,
      note: t.steps ? `${((t.failed / t.steps) * 100).toFixed(1)}% of steps` : "no steps yet",
      spark: per.map((x) => x.failed),
      tone: "danger" as const,
      to: "/sessions?failed=1",
    },
    {
      label: "Not reviewed",
      value: t.unreviewed,
      note: t.flagged ? `${n(t.flagged)} with risk flags` : "no risk flags",
      spark: undefined,
      tone: "plain" as const,
      to: "/sessions?verdict=none",
    },
  ];
  return (
    <section className="figures enter" style={stagger(1)} aria-label="Totals for the period">
      {items.map((f) => (
        <Link key={f.label} href={f.to} className="figure">
          <span className="figure-label">{f.label}</span>
          <span className="figure-row">
            <CountUp className="figure-value" value={f.value} format={n} />
            {f.spark && d.days > 1 ? <Spark values={f.spark} tone={f.tone} /> : null}
          </span>
          <span className="figure-note">{f.note}</span>
        </Link>
      ))}
    </section>
  );
}

function StepsChart({ d }: { d: DashboardData }) {
  const [hover, setHover] = useState<number | undefined>(undefined);
  const days = d.per_day;
  const total = (x: (typeof days)[number]) => KINDS.reduce((s, k) => s + x[k], 0);
  const max = Math.max(1, ...days.map(total));
  const h = hover !== undefined ? days[hover] : undefined;
  return (
    <section className="card chart-card enter" style={stagger(2)} aria-labelledby="steps-h">
      <div className="card-h">
        <h2 id="steps-h">Steps per day</h2>
        <span className="legend" aria-label="Colours">
          {KINDS.map((k) => (
            <span key={k}>
              <i className={`sw sw-${k}`}></i>
              {k}
            </span>
          ))}
        </span>
      </div>
      <div className="bars" onMouseLeave={() => setHover(undefined)} role="img" aria-label={`Steps per day over ${d.days} days, ${n(days.reduce((s, x) => s + total(x), 0))} in all`}>
        {days.map((x, i) => {
          const t = total(x);
          return (
            <div key={x.day} className={`bar-col${hover === i ? " hot" : ""}`} onMouseEnter={() => setHover(i)}>
              <div className="bar" style={{ height: `${(t / max) * 100}%`, ["--i" as string]: i }}>
                {(["failed", "other", "message", "read", "edit", "command"] as Kind[]).map((k) =>
                  x[k] > 0 ? <span key={k} className={`bar-seg sw-${k}`} style={{ flexGrow: x[k] }}></span> : null,
                )}
              </div>
              <span className="bar-x">{d.days <= 7 || i % 5 === 0 || i === days.length - 1 ? dayLabel(x.day, d.days) : ""}</span>
            </div>
          );
        })}
        {h && hover !== undefined && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / days.length) * 100}%`, transform: `translateX(${hover / days.length < 0.2 ? -10 : hover / days.length > 0.8 ? -90 : -50}%)` }}>
            <b>{new Date(`${h.day}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</b>
            <span>
              {n(total(h))} steps in {n(h.sessions)} session{h.sessions === 1 ? "" : "s"}
            </span>
            {KINDS.filter((k) => h[k] > 0).map((k) => (
              <span key={k} className="tip-row">
                <i className={`sw sw-${k}`}></i>
                {k} <b>{n(h[k])}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Running({ list }: { list: SessionSummary[] }) {
  return (
    <section className="card enter" style={stagger(3)} aria-labelledby="run-h">
      <div className="card-h">
        <h2 id="run-h">Running now</h2>
      </div>
      {list.length === 0 ? (
        <p className="card-empty">No agent is working right now. Sessions show up here while they run.</p>
      ) : (
        <div className="running">
          {list.map((s, i) => (
            <Link key={s.id} href={href(s)} className="run-item" style={{ ["--i" as string]: i }}>
              <span className="run-meta">
                <span className="run-dot" aria-hidden="true"></span>
                {agentName(s.agent.kind)} in {basename(s.workspace.root)}
              </span>
              <span className="run-title">{firstLine(s.title) || "No prompt recorded"}</span>
              <Strip strip={stripOf(s)} />
              <span className="run-steps">
                <b className="tick" key={s.steps_total}>
                  {n(s.steps_total)}
                </b>{" "}
                steps so far{s.failed_count ? `, ${s.failed_count} failed` : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function NeedsLook({ list }: { list: SessionSummary[] }) {
  return (
    <section className="card wide enter" style={stagger(4)} aria-labelledby="look-h">
      <div className="card-h">
        <h2 id="look-h">Needs a look</h2>
        <Link href="/sessions?verdict=none" className="card-link">
          All sessions not reviewed
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="card-empty">Nothing failed or was flagged in this period, or you have reviewed it all.</p>
      ) : (
        <div className="look-rows">
          {list.map((s, i) => (
            <Link key={s.id} href={href(s)} className="look-row" style={{ ["--i" as string]: i }}>
              <span className="look-main">
                <span className="look-title">{firstLine(s.title) || "No prompt recorded"}</span>
                <span className="look-sub">
                  <span className="proj">{basename(s.workspace.root)}</span>
                  <span>{new Date(s.started_at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</span>
                  {s.verdict?.state === "needs_attention" ? <span className="verdict-chip needs">Needs follow-up</span> : null}
                </span>
              </span>
              <Strip strip={stripOf(s)} />
              <span className="look-counts">
                {s.flag_count > 0 && <span className="flag">{s.flag_count} flagged</span>}
                {s.failed_count > 0 && <span className="fail">{s.failed_count} failed</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function Files({ files, days }: { files: DashboardData["files"]; days: number }) {
  const max = Math.max(1, ...files.map((f) => f.edits));
  return (
    <section className="card enter" style={stagger(5)} aria-labelledby="files-h">
      <div className="card-h">
        <h2 id="files-h">Most edited files</h2>
      </div>
      {files.length === 0 ? (
        <p className="card-empty">No files were edited {days === 1 ? "today" : "in this period"}.</p>
      ) : (
        <ul className="file-bars">
          {files.map((f, i) => (
            <li key={f.path} title={f.path} style={{ ["--i" as string]: i }}>
              <span className="file-row">
                <span className="file-path">{f.path.split("/").slice(-3).join("/")}</span>
                <span className="file-n">
                  {f.edits} edit{f.edits === 1 ? "" : "s"}
                </span>
              </span>
              <span className="file-track">
                <span style={{ width: `${(f.edits / max) * 100}%` }}></span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the dashboard">
      <div className="figures">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="figure">
            <span className="sk" style={{ width: "40%" }}></span>
            <span className="sk" style={{ width: "55%", height: 26, marginTop: 10 }}></span>
            <span className="sk" style={{ width: "70%", marginTop: 10 }}></span>
          </div>
        ))}
      </div>
      <div className="dash-grid">
        <div className="card chart-card">
          <span className="sk" style={{ height: 220 }}></span>
        </div>
        <div className="card">
          <span className="sk" style={{ height: 220 }}></span>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [days, setDays] = useState<Days>(7);
  const [data, setData] = useState<DashboardData | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const live = useLiveVersion();

  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem("postrun.period"));
      if (v === 1 || v === 7 || v === 30) setDays(v);
    } catch {
      // not remembered
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(api.dashboard(days))
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET /api/dashboard -> ${res.status}`);
        return (await res.json()) as DashboardData;
      })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(undefined);
        }
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [days, live]);

  const pick = (d: Days) => {
    setDays(d);
    try {
      window.localStorage.setItem("postrun.period", String(d));
    } catch {
      // not remembered
    }
  };

  if (error && !data) return <p className="error">Could not load the dashboard: {error}. Is Postrun running? Check with postrun status in a terminal.</p>;

  const nothingEver = data && data.totals.sessions === 0 && data.previous.sessions === 0 && data.running.length === 0 && days === 30;
  if (nothingEver && !DEMO) return <EmptySessions />;

  return (
    <>
      <header className="page-head enter">
        <div>
          <h1>Dashboard</h1>
          <p className="page-sub">What your agents did {days === 1 ? "today" : `in the last ${days} days`}, on this machine.</p>
        </div>
        <div className="seg" role="group" aria-label="Period">
          {PERIODS.map(([d, label]) => (
            <button key={d} type="button" className={days === d ? "on" : ""} aria-pressed={days === d} onClick={() => pick(d)}>
              {label}
            </button>
          ))}
        </div>
      </header>
      {!data ? (
        <DashboardSkeleton />
      ) : (
        <>
          <Figures d={data} />
          <div className="dash-grid">
            <StepsChart d={data} />
            <Running list={data.running} />
            <NeedsLook list={data.needs_review} />
            <Files files={data.files} days={days} />
          </div>
        </>
      )}
    </>
  );
}
