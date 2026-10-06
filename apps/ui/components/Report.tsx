"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useLiveVersion } from "@/lib/live";
import { stagger, useArrivals } from "@/lib/motion";
import { api, apiFetch, DEMO } from "@/lib/api";
import type { Step, Turn } from "@postrun/core/schema";
import type { SessionDeltaResponse, SessionDetailResponse } from "@postrun/core/server/api";
import { DeletePanel } from "@/components/DeletePanel";
import { ExportPanel } from "@/components/ExportPanel";
import { StepRow } from "@/components/StepRow";
import { Tape } from "@/components/Tape";
import { projectHref } from "@/components/Projects";
import { ChangesView, GitPanel, RiskPanel, ShortcutHelp, VerdictPanel } from "@/components/ReviewPanels";
import { changesByFile, commitsOf, plainSummary, prSummary } from "@/lib/review";

type Tab = "timeline" | "changes" | "files";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page without clipboard permission: select a hidden textarea and copy.
    const t = document.createElement("textarea");
    t.value = text;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  }
}

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

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
  const [deleting, setDeleting] = useState(false);
  // Long sessions show their most recent turns; earlier ones load on request. A link to a step shows everything.
  const [shownTurns, setShownTurns] = useState(() => (typeof window !== "undefined" && window.location.hash.startsWith("#step-") ? Infinity : RECENT_TURNS));
  // Bumps when this session is written (a running agent, a late hook record) and on reconnect.
  const live = useLiveVersion(id || undefined);
  const [tab, setTab] = useState<Tab>("timeline");
  const [help, setHelp] = useState(false);
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  // The verdict keys on the session page fire the panel's buttons, so the panel stays the one place that saves.
  const verdictKeys = useRef<{ approve?: () => void; needs?: () => void }>({});

  const copyPr = useCallback(async () => {
    if (state.kind !== "ready") return;
    const ok = await copyText(prSummary(state.data));
    setCopied(ok ? "ok" : "fail");
    window.setTimeout(() => setCopied("idle"), 2200);
  }, [state]);

  // The data on screen, readable from inside the fetch effect without re-running it, and a full
  // load still in flight, so a live update that lands during it waits for it instead of loading twice.
  const current = useRef<SessionDetailResponse | undefined>(undefined);
  const inflight = useRef<{ id: string; promise: Promise<SessionDetailResponse> } | undefined>(undefined);
  useEffect(() => {
    current.current = state.kind === "ready" ? state.data : undefined;
  }, [state]);

  useEffect(() => {
    if (!id) {
      setState({ kind: "error", message: "no session id in the URL (expected /session?id=...)" });
      return;
    }
    let cancelled = false;
    const loadFull = (): Promise<SessionDetailResponse> => {
      const promise = (async () => {
        const res = await apiFetch(api.session(id));
        if (!res.ok) throw new Error(`GET /api/sessions/${id} -> ${res.status}`);
        return (await res.json()) as SessionDetailResponse;
      })();
      inflight.current = { id, promise };
      void promise.finally(() => {
        if (inflight.current?.promise === promise) inflight.current = undefined;
      }).catch(() => undefined);
      return promise;
    };
    // A live update asks only for what changed since the data on screen, and merges it in.
    const load = async (): Promise<SessionDetailResponse> => {
      let have = current.current;
      if (!have && inflight.current?.id === id) have = await inflight.current.promise;
      if (!have || have.summary.id !== id) return loadFull();
      const res = await apiFetch(api.sessionSince(id, have.as_of));
      if (!res.ok) throw new Error(`GET /api/sessions/${id}?since -> ${res.status}`);
      const delta = (await res.json()) as SessionDeltaResponse;
      if (delta.reload) return loadFull();
      const byId = new Map(have.steps.map((s) => [s.id, s]));
      for (const s of delta.steps) byId.set(s.id, s);
      const { delta: _d, reload: _r, ...rest } = delta;
      return { ...rest, steps: [...byId.values()].sort((a, b) => a.seq - b.seq) };
    };
    load()
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((err: unknown) => {
        // A failed live refetch keeps what is on screen (the top bar shows the server is offline), except
        // "not found": the session was deleted, so say so instead of showing stale data.
        const message = err instanceof Error ? err.message : String(err);
        if (!cancelled) setState((prev) => (prev.kind === "ready" && prev.data.summary.id === id && !/-> 404$/.test(message) ? prev : { kind: "error", message }));
      });
    return () => {
      cancelled = true;
    };
  }, [id, live]);

  // Steps an agent writes while you watch get a brief highlight. Before the early returns: hooks run every render.
  const arrived = useArrivals(state.kind === "ready" && state.data.summary.id === id ? state.data.steps.map((s) => s.id) : undefined, id);

  // Keyboard review: j/k move through steps, f jumps to the next failure, e opens the current one.
  const cur = useRef(-1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Holding a key repeats it: fine for moving through steps, never for reviewing or copying.
      if (e.repeat && (e.key === "a" || e.key === "n" || e.key === "c" || e.key === "?")) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const steps = () => [...document.querySelectorAll<HTMLDetailsElement>("details.step-d")];
      const focus = (list: HTMLDetailsElement[], i: number) => {
        const el = list[i];
        if (!el) return;
        list.forEach((d) => d.classList.remove("kbd-current"));
        cur.current = i;
        el.classList.add("kbd-current");
        el.querySelector("summary")?.focus({ preventScroll: true });
        el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      };
      const fromFocus = (list: HTMLDetailsElement[]) => {
        const at = list.findIndex((d) => d.contains(document.activeElement));
        return at >= 0 ? at : cur.current;
      };
      switch (e.key) {
        case "j":
        case "k": {
          if (tab !== "timeline") setTab("timeline");
          const list = steps();
          const at = fromFocus(list);
          focus(list, Math.max(0, Math.min(list.length - 1, at + (e.key === "j" ? 1 : -1))));
          break;
        }
        case "f": {
          if (tab !== "timeline") setTab("timeline");
          const list = steps();
          const at = fromFocus(list);
          const next = list.findIndex((d, i) => i > at && d.classList.contains("failed"));
          const wrap = next >= 0 ? next : list.findIndex((d) => d.classList.contains("failed"));
          if (wrap >= 0) focus(list, wrap);
          break;
        }
        case "e": {
          const list = steps();
          const el = list[fromFocus(list)];
          if (el) el.open = !el.open;
          break;
        }
        case "g":
          window.scrollTo({ top: 0, behavior: "smooth" });
          cur.current = -1;
          break;
        case "1":
          setTab("timeline");
          break;
        case "2":
          setTab("changes");
          break;
        case "3":
          setTab("files");
          break;
        case "a":
          verdictKeys.current.approve?.();
          break;
        case "n":
          verdictKeys.current.needs?.();
          break;
        case "c":
          void copyPr();
          break;
        case "?":
          setHelp((h) => !h);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, copyPr]);

  if (state.kind === "loading") return <ReportSkeleton />;
  if (state.kind === "error")
    return /-> 404$/.test(state.message) ? (
      <p className="muted-block">
        This session is not in Postrun anymore; it may have been deleted. <a href="/sessions">See all sessions</a>
      </p>
    ) : (
      <p className="error">Could not load session: {state.message}</p>
    );

  const { summary, turns, steps, report, segments } = state.data;

  /** Open a step in the timeline and bring it into view (from the tape). Shows every turn first if needed. */
  const jumpTo = (seq: number) => {
    setTab("timeline");
    setShownTurns(Infinity);
    window.history.replaceState(null, "", `#step-${seq}`);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.getElementById(`step-${seq}`) as HTMLDetailsElement | null;
        if (!el) return;
        el.open = true;
        el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        el.classList.remove("jumped");
        void el.offsetWidth; // restart the highlight
        el.classList.add("jumped");
      }),
    );
  };
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

  const changes = changesByFile(steps, summary.workspace.root);
  const commits = commitsOf(steps);
  const setVerdict = (v: typeof summary.verdict | undefined) =>
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      const { verdict: _old, ...rest } = prev.data.summary;
      return { kind: "ready", data: { ...prev.data, summary: v ? { ...rest, verdict: v } : rest } };
    });
  const TABS: [Tab, string, number][] = [
    ["timeline", "Timeline", summary.steps_total],
    ["changes", "Changes", changes.length],
    ["files", "Files and commands", report.counts.files_touched + report.counts.commands_run],
  ];

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/sessions">Sessions</Link>
        <span aria-hidden="true">/</span>
        <Link href={projectHref(summary.workspace.root)}>{basename(summary.workspace.root)}</Link>
        <span aria-hidden="true">/</span>
        <span className="crumb-here">{firstLine(summary.title, 60) || "Session"}</span>
        <span className="grow"></span>
        <button type="button" className="kbd-hint" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts">
          <kbd>?</kbd> shortcuts
        </button>
      </nav>

      {/* HERO */}
      <div className="hero enter">
        <div className="hero-glow"></div>
        <div className="hero-card">
          <div className="hero-top">
            <span className={`badge ${summary.agent.kind === "cline" ? "cline" : "cc"}`}>{summary.agent.kind}</span>
            <h1 className="title">{firstLine(summary.title, 140) || summary.id}</h1>
            {summary.agent.version && summary.agent.version !== "unknown" ? <span className="ver">v{summary.agent.version}</span> : null}
            <button type="button" className={`btn copy-btn ${copied}`} onClick={() => void copyPr()} title="Markdown for a pull request description (c)">
              <span className="copy-label" key={copied}>
                {copied === "ok" ? "Copied" : copied === "fail" ? "Could not copy" : "Copy as PR summary"}
              </span>
            </button>
            <button type="button" className="btn" onClick={() => (setExporting((v) => !v), setDeleting(false))} aria-expanded={exporting}>
              Export report
            </button>
            {!DEMO && (
              <button type="button" className="btn ghost danger-text" onClick={() => (setDeleting((v) => !v), setExporting(false))} aria-expanded={deleting}>
                Delete
              </button>
            )}
          </div>

          <p className="plain-sum">
            {plainSummary(state.data)
              .split(/(`[^`]+`)/)
              .map((part, i) => (part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part))}
          </p>

          <div className="stats">
            <div className="stat">
              <div className="k">cost</div>
              {summary.metrics.api_requests > 0 ? (
                <div className="v mono">
                  ${summary.metrics.cost_usd.toFixed(4)} <span className="sub">/ {summary.metrics.api_requests} req</span>
                </div>
              ) : (
                // No API data, e.g. a Claude Code session recorded from hooks while the receiver was down.
                <div className="v muted-v" title="This session has no API data, so cost and tokens were not recorded">
                  not recorded
                </div>
              )}
            </div>
            <div className="stat">
              <div className="k">steps</div>
              <div className="v mono tick" key={summary.steps_total}>
                {summary.steps_total}
              </div>
            </div>
            <div className="stat">
              <div className="k">turns</div>
              <div className="v mono tick" key={turns.length}>
                {turns.length}
              </div>
            </div>
            <div className="stat danger">
              <div className="k">failed</div>
              <div className="v mono tick" key={summary.failed_count}>
                {summary.failed_count}
              </div>
            </div>
            <div className="stat warn">
              <div className="k">reference-only</div>
              <div className="v mono tick" key={summary.reference_only_count}>
                {summary.reference_only_count}
              </div>
            </div>
          </div>

          <Tape steps={steps} onPick={jumpTo} />

          <div className="meta-row">
            <span>
              workspace{" "}
              <Link className="mono meta-link" href={projectHref(summary.workspace.root)}>
                {summary.workspace.root}
              </Link>
            </span>
            {summary.git_branch ? (
              <span>
                branch <b className="mono">{summary.git_branch}</b>
              </span>
            ) : null}
            <span>
              when <b className="mono">{formatDate(summary.started_at)} → {summary.ended_at ? formatDate(summary.ended_at) : "open"}</b> &middot; {segments.length} segment
              {segments.length === 1 ? "" : "s"}
            </span>
            <span>
              owner <b className="mono">{summary.owner_id}</b> on {summary.captured_on}
            </span>
            {summary.metrics.api_requests > 0 ? (
              <span>
                tokens <b className="mono">{summary.metrics.tokens.input} in / {summary.metrics.tokens.output} out</b>
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {exporting && <ExportPanel sessionId={summary.id} onClose={() => setExporting(false)} />}
      {deleting && <DeletePanel sessionId={summary.id} agent={summary.agent.kind} steps={summary.steps_total} onClose={() => setDeleting(false)} />}

      <div className={`review-row enter${commits.length || summary.git_branch ? " three" : ""}`} style={stagger(1, 12, 60)}>
        <VerdictPanel summary={summary} onSaved={setVerdict} bind={verdictKeys} />
        <RiskPanel steps={steps} onPick={jumpTo} />
        <GitPanel branch={summary.git_branch} commits={commits} onPick={jumpTo} />
      </div>

      <div className="tabs enter" role="tablist" aria-label="Session views" style={stagger(2, 12, 60)}>
        {TABS.map(([k, label, n]) => (
          <button key={k} type="button" role="tab" id={`tab-${k}`} title={`${label} (${TABS.findIndex((t) => t[0] === k) + 1})`} aria-selected={tab === k} aria-controls={`panel-${k}`} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
            <span className="tab-n">{n.toLocaleString()}</span>
          </button>
        ))}
      </div>

      {tab === "changes" && (
        <div className="sec tab-panel" role="tabpanel" id="panel-changes" aria-labelledby="tab-changes">
          <ChangesView steps={steps} root={summary.workspace.root} onPick={jumpTo} />
        </div>
      )}

      {tab === "files" && (
      <div className="tab-panel" role="tabpanel" id="panel-files" aria-labelledby="tab-files">
      {/* FILES TOUCHED */}
      <div className="sec enter" style={stagger(0, 12, 60)}>
        <div className="sec-h">
          <h2>Files touched</h2>
          <span className="count">
            {report.counts.files_touched} &middot; {report.counts.files_created} created, {report.counts.files_edited} edited, {report.counts.files_read} read
          </span>
        </div>
        {report.files.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No files were created, edited, or read.</p>
        ) : (
          <div className="table-scroll" tabIndex={0}>
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
      <div className="sec enter" style={stagger(1, 12, 60)}>
        <div className="sec-h">
          <h2>Commands run</h2>
          <span className="count">
            {report.counts.commands_run} &middot; {report.counts.commands_failed} failed, {report.counts.commands_reference_only} output not inline
          </span>
        </div>
        {report.commands.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No commands were run.</p>
        ) : (
          <div className="table-scroll" tabIndex={0}>
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

      </div>
      )}

      {/* TIMELINE */}
      {tab === "timeline" && (
      <div className="sec tab-panel" role="tabpanel" id="panel-timeline" aria-labelledby="tab-timeline">
        <div className="sec-h">
          <h2>Timeline</h2>
          <span className="count">
            {turns.length} turns &middot; {summary.steps_total} steps
          </span>
          <span className="sec-actions">
            <button type="button" className="link-btn" onClick={() => setAllSteps(true)}>
              Expand all
            </button>
            <button type="button" className="link-btn" onClick={() => setAllSteps(false)}>
              Collapse all
            </button>
          </span>
        </div>

        {(() => {
          const all = [...turns, ...orphanTurns];
          const hidden = Math.max(0, all.length - shownTurns);
          return (
            <>
              {hidden > 0 && (
                <button type="button" className="more-turns" onClick={() => setShownTurns((n) => n + EARLIER_TURNS_STEP)}>
                  Show {Math.min(hidden, EARLIER_TURNS_STEP)} earlier turn{Math.min(hidden, EARLIER_TURNS_STEP) === 1 ? "" : "s"}
                  <span className="muted"> &middot; {hidden} hidden</span>
                </button>
              )}
              {all.slice(hidden).map((t, i) => (
                <TurnBlock key={t.id} turn={t} steps={stepsByTurn.get(t.id) ?? EMPTY} sessionId={summary.id} arrived={arrived} order={i} />
              ))}
            </>
          );
        })()}
      </div>
      )}

      {help && <ShortcutHelp onClose={() => setHelp(false)} />}

      <div className="foot">
        postrun &middot; <span className="mono">session {summary.id}</span> &middot; local review, nothing left your machine
      </div>
    </>
  );
}

/** Turns shown when a session opens, and how many more each "earlier turns" click adds. */
const RECENT_TURNS = 30;
const EARLIER_TURNS_STEP = 50;
const EMPTY: Step[] = [];

/**
 * One turn of the timeline. Memoized: a live update re-renders only turns whose steps changed
 * (unchanged steps keep their object identity through a delta merge), so a long session does not
 * redraw thousands of rows every time an agent finishes a turn.
 */
const TurnBlock = memo(
  function TurnBlock({ turn, steps, sessionId, arrived, order }: { turn: Turn; steps: Step[]; sessionId: string; arrived: Set<string>; order: number }) {
    const prompt = steps.find((s) => s.type === "message" && s.payload.role === "user");
    const promptText = prompt && prompt.type === "message" ? prompt.payload.text : undefined;
    return (
      <div className="turn enter" style={stagger(order, 8, 45)}>
        <div className="turn-h">
          <span className="turn-n">turn {turn.index}</span>
          <span className="txt">{firstLine(promptText || "", 120)}</span>
          <span className="mode">{turn.mode || "no mode"}</span>
        </div>
        {steps.map((s) => (
          <StepRow key={s.id} step={s} sessionId={sessionId} fresh={arrived.has(s.id)} />
        ))}
      </div>
    );
  },
  (a, b) =>
    a.sessionId === b.sessionId &&
    a.turn.id === b.turn.id &&
    a.turn.index === b.turn.index &&
    a.turn.mode === b.turn.mode &&
    a.steps.length === b.steps.length &&
    a.steps.every((s, i) => s === b.steps[i]),
);

/** Open or close every step in the timeline. Each step renders its body when it opens. */
function setAllSteps(open: boolean): void {
  document.querySelectorAll<HTMLDetailsElement>("details.step-d").forEach((d) => {
    d.open = open;
  });
}

/** Placeholder while a session loads: the summary card and a few timeline rows. */
function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading session">
      <div className="hero">
        <div className="hero-card skeleton-card">
          <span className="sk sk-line" style={{ width: "46%" }}></span>
          <div className="sk-stats">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="sk sk-tile"></span>
            ))}
          </div>
        </div>
      </div>
      <div className="sec">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="sk sk-step" style={{ animationDelay: `${i * 90}ms` }}></span>
        ))}
      </div>
    </div>
  );
}
