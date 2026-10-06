"use client";

/**
 * The session list: every recorded session, grouped by day, as a list or a
 * grid. Each session shows its strip (components/Strip.tsx), the shape of
 * what the agent did. Search, the agent filter, empty sessions and the view
 * are all on the toolbar; the view and the empty-sessions choice are
 * remembered in this browser.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptySessions } from "@/components/EmptySessions";
import { Strip, StripLegend, stripOf } from "@/components/Strip";
import { useLiveVersion } from "@/lib/live";
import { stagger, useArrivals } from "@/lib/motion";
import { activeFilters, fetchSessions, NO_FILTERS, PAGE_SIZE, type ListFilters, type Size } from "@/lib/sessions";
import type { SessionListResponse } from "@postrun/core/server/api";
import type { SessionSummary } from "@postrun/core/store";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: SessionListResponse; key: string };
type View = "list" | "grid";

const AGENT_NAME: Record<string, string> = { "claude-code": "Claude Code", cline: "Cline" };
const agentName = (k: string) => AGENT_NAME[k] ?? k;

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

function firstLine(s: string | undefined, max = 140): string {
  if (!s) return "";
  const line = s.split("\n")[0] ?? "";
  return line.length > max ? line.slice(0, max) + "…" : line;
}

function relativeTime(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(ms / 86400000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** "Today", "Yesterday", or the date, for the day a session started (local time). */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

const money = (n: number) => `$${n.toFixed(2)}`;

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private window or blocked storage: the choice just is not remembered
  }
}

export function SessionList() {
  const params = useSearchParams();
  const agent = params.get("agent") ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [filters, setFilters] = useState<Omit<ListFilters, "agent">>(NO_FILTERS);
  const [typed, setTyped] = useState(""); // the search box, applied after a short pause
  const [view, setView] = useState<View>("list");
  const [more, setMore] = useState<"idle" | "loading" | "error">("idle");
  const search = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  // Bumps on any session write and on reconnect: the loaded pages refetch in place.
  const live = useLiveVersion();
  const f: ListFilters = useMemo(() => ({ ...filters, agent }), [filters, agent]);
  const key = JSON.stringify(f);
  const loaded = useRef(PAGE_SIZE);

  // Remembered choices, read after mount (the page is a static export).
  useEffect(() => {
    setView(readPref("postrun.view", ["list", "grid"] as const, "list"));
    const empty = readPref("postrun.empty", ["show", "hide"] as const, "hide") === "show";
    setFilters((x) => ({ ...x, empty }));
  }, []);

  // "/" jumps to search, as in most developer tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && t?.tagName !== "INPUT" && t?.tagName !== "TEXTAREA" && t?.tagName !== "SELECT") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setFilters((x) => (x.q === typed ? x : { ...x, q: typed })), 250);
    return () => clearTimeout(t);
  }, [typed]);

  // New filters: the first page. A live update: the pages already shown, refreshed in one request.
  const lastKey = useRef("");
  useEffect(() => {
    let cancelled = false;
    const sameFilters = lastKey.current === key;
    lastKey.current = key;
    if (!sameFilters) loaded.current = PAGE_SIZE;
    fetchSessions(f, Math.min(Math.max(loaded.current, PAGE_SIZE), 500))
      .then((data) => {
        if (cancelled) return;
        loaded.current = Math.max(PAGE_SIZE, data.sessions.length);
        setState({ kind: "ready", data, key });
        setMore("idle");
      })
      .catch((err: unknown) => {
        // A failed live refetch keeps what is on screen; the top bar already shows the server is offline.
        if (!cancelled) setState((prev) => (prev.kind === "ready" ? prev : { kind: "error", message: err instanceof Error ? err.message : String(err) }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, live]);

  const ready = state.kind === "ready" ? state.data : undefined;
  const current = state.kind === "ready" && state.key === key;

  const loadMore = useCallback(() => {
    if (!ready?.next_cursor || more === "loading" || !current) return;
    setMore("loading");
    fetchSessions(f, PAGE_SIZE, ready.next_cursor)
      .then((page) => {
        setState((prev) => {
          if (prev.kind !== "ready" || prev.key !== key) return prev;
          const seen = new Set(prev.data.sessions.map((s) => s.id));
          const sessions = [...prev.data.sessions, ...page.sessions.filter((s) => !seen.has(s.id))];
          loaded.current = sessions.length;
          const data: SessionListResponse = { ...page, sessions };
          if (!page.next_cursor) delete data.next_cursor;
          return { kind: "ready", data, key };
        });
        setMore("idle");
      })
      .catch(() => setMore("error"));
  }, [ready, more, current, f, key]);

  // The next page loads as you scroll near the end.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !ready?.next_cursor) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ready?.next_cursor, loadMore]);

  // Sessions that start while the list is open slide in and glow once. Hooks run on every render.
  const arrived = useArrivals(current ? ready!.sessions.map((s) => s.id) : undefined, key);

  const groups = useMemo(() => {
    const out: Array<{ label: string; sessions: SessionSummary[]; cost: number }> = [];
    for (const s of ready?.sessions ?? []) {
      const label = dayLabel(s.started_at);
      const g = out[out.length - 1];
      if (g && g.label === label) {
        g.sessions.push(s);
        g.cost += s.metrics.cost_usd;
      } else out.push({ label, sessions: [s], cost: s.metrics.cost_usd });
    }
    return out;
  }, [ready]);

  if (state.kind === "loading") return <ListSkeleton />;
  if (state.kind === "error")
    return <p className="error">Could not load sessions: {state.message}. Is Postrun running? Check with postrun status in a terminal.</p>;

  const data = ready!;
  const narrowed = activeFilters(f) > 0;
  const set = (patch: Partial<Omit<ListFilters, "agent">>) => setFilters((x) => ({ ...x, ...patch }));
  const pickView = (v: View) => {
    setView(v);
    writePref("postrun.view", v);
  };
  const toggleEmpty = () => {
    writePref("postrun.empty", filters.empty ? "hide" : "show");
    set({ empty: !filters.empty });
  };
  const clearAll = () => {
    setTyped("");
    setFilters((x) => ({ ...NO_FILTERS, empty: x.empty }));
  };

  // Nothing recorded at all yet: the first-run screen.
  if (data.total === 0 && data.empty_count === 0 && !narrowed && !agent) return <EmptySessions />;

  let order = 0;
  return (
    <>
      <header className="list-head enter">
        <h1>Sessions</h1>
        <p className="list-sum" aria-live="polite">
          {narrowed || agent
            ? `${data.total} matching${data.total_cost > 0 ? `, ${money(data.total_cost)} in reported cost` : ""}`
            : `${data.total} recorded on this machine${data.total_cost > 0 ? `, ${money(data.total_cost)} in reported cost` : ""}`}
        </p>
      </header>

      <div className="toolbar enter" style={stagger(1)}>
        <label className="search">
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="sr-only">Search sessions</span>
          <input ref={search} type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search prompts and projects" autoComplete="off" spellCheck={false} />
          {!typed && <kbd aria-hidden="true">/</kbd>}
        </label>

        <nav className="seg" aria-label="Agent">
          <Link href="/" className={agent === "" ? "on" : ""} aria-current={agent === "" ? "page" : undefined}>
            All
          </Link>
          {data.agents.map((a) => (
            <Link key={a} href={`/?agent=${encodeURIComponent(a)}`} className={agent === a ? "on" : ""} aria-current={agent === a ? "page" : undefined}>
              {agentName(a)}
            </Link>
          ))}
        </nav>

        <span className="grow"></span>

        <div className="seg seg-icons" role="group" aria-label="View">
          <button type="button" className={view === "list" ? "on" : ""} aria-pressed={view === "list"} onClick={() => pickView("list")}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            List
          </button>
          <button type="button" className={view === "grid" ? "on" : ""} aria-pressed={view === "grid"} onClick={() => pickView("grid")}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <rect x="9" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <rect x="2" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <rect x="9" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            Grid
          </button>
        </div>
      </div>

      <div className="filterbar enter" style={stagger(2)} role="group" aria-label="Filters">
        <div className="seg" role="group" aria-label="When">
          {(
            [
              ["all", "Any time"],
              ["today", "Today"],
              ["7d", "7 days"],
              ["30d", "30 days"],
              ["custom", "Dates"],
            ] as const
          ).map(([r, label]) => (
            <button key={r} type="button" className={f.range === r ? "on" : ""} aria-pressed={f.range === r} onClick={() => set({ range: r })}>
              {label}
            </button>
          ))}
        </div>
        {f.range === "custom" && (
          <span className="dates">
            <label>
              <span className="sr-only">From</span>
              <input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <span aria-hidden="true">to</span>
            <label>
              <span className="sr-only">To</span>
              <input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} />
            </label>
          </span>
        )}
        <label className="select">
          <span className="sr-only">Size</span>
          <select value={f.size} onChange={(e) => set({ size: Number(e.target.value) as Size })}>
            <option value={0}>Any size</option>
            <option value={10}>10+ steps</option>
            <option value={100}>100+ steps</option>
          </select>
        </label>
        <button type="button" className={`toggle${f.failed ? " on" : ""}`} aria-pressed={f.failed} onClick={() => set({ failed: !f.failed })}>
          <span className="knob" aria-hidden="true"></span>
          With failures
        </button>
        {data.empty_count > 0 && (
          <button type="button" className={`toggle${f.empty ? " on" : ""}`} aria-pressed={f.empty} onClick={toggleEmpty}>
            <span className="knob" aria-hidden="true"></span>
            Empty sessions <span className="count">{data.empty_count}</span>
          </button>
        )}
        {narrowed && (
          <button type="button" className="link-btn clear" onClick={clearAll}>
            Clear filters
          </button>
        )}
        <span className="grow"></span>
        <StripLegend />
      </div>

      <div className={current ? "results" : "results stale"} aria-busy={!current}>
        {data.sessions.length === 0 ? (
          <p className="no-match">
            {narrowed ? (
              <>
                No session matches these filters.{" "}
                <button type="button" className="link-btn" onClick={clearAll}>
                  Clear filters
                </button>
              </>
            ) : agent ? (
              `No ${agentName(agent)} sessions yet.`
            ) : (
              <>
                Only empty sessions so far.{" "}
                <button type="button" className="link-btn" onClick={toggleEmpty}>
                  Show them
                </button>
              </>
            )}
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="day" aria-label={g.label}>
              <h2 className="day-h">
                <span>{g.label}</span>
                <span className="day-meta">
                  {g.sessions.length} session{g.sessions.length === 1 ? "" : "s"}
                  {g.cost > 0 ? `, ${money(g.cost)}` : ""}
                </span>
              </h2>
              <div className={view === "grid" ? "cards" : "rows"}>
                {g.sessions.map((s) => {
                  const i = order++;
                  const cls = arrived.has(s.id) ? " arrived" : " enter";
                  return view === "grid" ? <Card key={s.id} s={s} cls={cls} i={i} /> : <Row key={s.id} s={s} cls={cls} i={i} />;
                })}
              </div>
            </section>
          ))
        )}

        {data.next_cursor ? (
          <div ref={sentinel} className="more">
            {more === "loading" ? (
              <div className={view === "grid" ? "cards" : "rows"} aria-label="Loading more sessions">
                {[0, 1, 2].map((i) => (view === "grid" ? <SkeletonCard key={i} i={i} /> : <SkeletonRow key={i} i={i} />))}
              </div>
            ) : (
              <button type="button" className="more-btn" onClick={loadMore}>
                {more === "error" ? "Could not load more. Try again" : `Show more (${data.total - data.sessions.length} left)`}
              </button>
            )}
          </div>
        ) : data.sessions.length > 0 ? (
          <div className="foot">
            {data.total} session{data.total === 1 ? "" : "s"}, all shown. Recorded and stored on this machine only.
          </div>
        ) : null}
      </div>
    </>
  );
}

function href(s: SessionSummary): string {
  return `/session?id=${encodeURIComponent(s.id)}`;
}

function Title({ s }: { s: SessionSummary }) {
  const t = firstLine(s.title);
  return t ? <>{t}</> : <span className="untitled">No prompt recorded</span>;
}

function Cost({ s }: { s: SessionSummary }) {
  return s.metrics.api_requests > 0 ? (
    <span className="cost">{money(s.metrics.cost_usd)}</span>
  ) : (
    <span className="cost none" title="Cost not recorded for this session">
      no cost data
    </span>
  );
}

function Row({ s, cls, i }: { s: SessionSummary; cls: string; i: number }) {
  return (
    <Link href={href(s)} className={`srow${cls}`} style={stagger(i)}>
      <span className={`agent-dot ${s.agent.kind === "cline" ? "cline" : "cc"}`} title={agentName(s.agent.kind)}></span>
      <span className="srow-main">
        <span className="srow-title">
          <Title s={s} />
        </span>
        <span className="srow-sub">
          <span className="proj">{basename(s.workspace.root)}</span>
          <span>{agentName(s.agent.kind)}</span>
          {s.failed_count > 0 && <span className="fail">{s.failed_count} failed</span>}
          {s.flag_count > 0 && <span className="flag">{s.flag_count} flagged</span>}
        </span>
      </span>
      <Strip strip={stripOf(s)} />
      <span className="srow-num">
        {/* Keyed by value: a new count re-mounts and ticks in. */}
        <b className="tick" key={s.steps_total}>
          {s.steps_total}
        </b>{" "}
        step{s.steps_total === 1 ? "" : "s"}
      </span>
      <Cost s={s} />
      <time className="srow-time" dateTime={s.started_at} title={new Date(s.started_at).toLocaleString()}>
        {clock(s.started_at)}
      </time>
    </Link>
  );
}

function Card({ s, cls, i }: { s: SessionSummary; cls: string; i: number }) {
  return (
    <Link href={href(s)} className={`scard${cls}`} style={stagger(i)}>
      <span className="scard-top">
        <span className="proj">{basename(s.workspace.root)}</span>
        <span className={`badge ${s.agent.kind === "cline" ? "cline" : "cc"}`}>{agentName(s.agent.kind)}</span>
      </span>
      <span className="scard-title">
        <Title s={s} />
      </span>
      <Strip strip={stripOf(s)} size="card" />
      <span className="scard-foot">
        <span>
          <b className="tick" key={s.steps_total}>
            {s.steps_total}
          </b>{" "}
          step{s.steps_total === 1 ? "" : "s"}
        </span>
        {s.failed_count > 0 && <span className="fail">{s.failed_count} failed</span>}
        <Cost s={s} />
        <span className="grow"></span>
        <time dateTime={s.started_at} title={new Date(s.started_at).toLocaleString()}>
          {relativeTime(s.started_at)}
        </time>
      </span>
    </Link>
  );
}

/** Placeholder shapes while sessions load, with a soft sheen. */
function SkeletonRow({ i }: { i: number }) {
  return (
    <div className="srow skeleton-row" style={{ animationDelay: `${i * 90}ms` }} aria-hidden="true">
      <span className="sk" style={{ width: 9, height: 9, borderRadius: 9 }}></span>
      <span className="srow-main">
        <span className="sk" style={{ width: "70%" }}></span>
        <span className="sk" style={{ width: "30%", height: 9 }}></span>
      </span>
      <span className="sk" style={{ height: 18 }}></span>
      <span className="sk" style={{ width: 50, justifySelf: "end" }}></span>
      <span className="sk" style={{ width: 40, justifySelf: "end" }}></span>
      <span className="sk" style={{ width: 36, justifySelf: "end" }}></span>
    </div>
  );
}

function SkeletonCard({ i }: { i: number }) {
  return (
    <div className="scard skeleton-row" style={{ animationDelay: `${i * 90}ms` }} aria-hidden="true">
      <span className="sk" style={{ width: "40%" }}></span>
      <span className="sk" style={{ width: "85%", height: 14 }}></span>
      <span className="sk" style={{ height: 34 }}></span>
      <span className="sk" style={{ width: "50%" }}></span>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading sessions">
      <header className="list-head">
        <h1>Sessions</h1>
        <span className="sk" style={{ width: 240, marginTop: 10 }}></span>
      </header>
      <div className="toolbar">
        <span className="sk" style={{ width: 340, height: 36, borderRadius: 10 }}></span>
        <span className="sk" style={{ width: 200, height: 36, borderRadius: 10 }}></span>
      </div>
      <div className="day">
        <span className="sk" style={{ width: 80, marginBottom: 12 }}></span>
        <div className="rows">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonRow key={i} i={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
