"use client";

/**
 * The review panels on the session page: your verdict and note, risk flags,
 * the commits the agent made, the per-file changes, and the keyboard help.
 */

import { useEffect, useState, type MutableRefObject } from "react";
import type { Step } from "@postrun/core/schema";
import type { SessionSummary } from "@postrun/core/store";
import { api, DEMO } from "@/lib/api";
import { changesByFile, type Commit, type FileChange, riskFlagsOf } from "@/lib/review";

type VerdictState = "approved" | "needs_attention";

/** Looks good / Needs follow-up, with an optional note. Saved on this machine. */
export function VerdictPanel({
  summary,
  onSaved,
  bind,
}: {
  summary: SessionSummary;
  onSaved: (v: SessionSummary["verdict"] | undefined) => void;
  /** Filled with the two actions, so the page's a and n keys save through this panel. */
  bind?: MutableRefObject<{ approve?: () => void; needs?: () => void }>;
}) {
  const current = summary.verdict;
  const [state, setState] = useState<VerdictState | null>((current?.state as VerdictState | undefined) ?? null);
  const [note, setNote] = useState(current?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | undefined>(undefined);
  const [pop, setPop] = useState(0);

  // Another tab or the list changed it: follow, unless you are typing a note.
  useEffect(() => {
    setState((current?.state as VerdictState | undefined) ?? null);
    setNote((n) => (document.activeElement?.id === "verdict-note" ? n : (current?.note ?? "")));
  }, [current?.state, current?.note]);

  const save = async (next: VerdictState | null, nextNote = note) => {
    setState(next);
    setPop((p) => p + 1);
    setMsg(undefined);
    if (DEMO) {
      onSaved(next ? { state: next, ...(nextNote ? { note: nextNote } : {}) } : undefined);
      setMsg({ tone: "ok", text: "In the demo, reviews are not saved." });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(api.verdict(summary.id), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: next, ...(nextNote.trim() ? { note: nextNote.trim() } : {}) }) });
      if (!r.ok) throw new Error(`could not save (${r.status})`);
      onSaved(next ? { state: next, ...(nextNote.trim() ? { note: nextNote.trim() } : {}) } : undefined);
      setMsg({ tone: "ok", text: next ? "Saved." : "Review cleared." });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    if (!bind) return;
    bind.current = { approve: () => void save("approved"), needs: () => void save("needs_attention") };
  });
  const dirty = (current?.note ?? "") !== note.trim() && state !== null;

  return (
    <section className={`panel verdict-panel v-${state ?? "none"}`} aria-labelledby="verdict-h">
      <div className="panel-h">
        <h2 id="verdict-h">Your review</h2>
        {state && (
          <button type="button" className="link-btn" onClick={() => void save(null, "")} disabled={saving}>
            Clear
          </button>
        )}
      </div>
      <div className="verdict-choices" role="radiogroup" aria-label="Review">
        <button type="button" role="radio" aria-checked={state === "approved"} className={`verdict-choice ok${state === "approved" ? " on" : ""}`} onClick={() => void save("approved")} disabled={saving}>
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Looks good
          <kbd>a</kbd>
        </button>
        <button type="button" role="radio" aria-checked={state === "needs_attention"} className={`verdict-choice needs${state === "needs_attention" ? " on" : ""}`} onClick={() => void save("needs_attention")} disabled={saving}>
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3.5v5.5M8 12v.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
          Needs follow-up
          <kbd>n</kbd>
        </button>
      </div>
      <label className="sr-only" htmlFor="verdict-note">
        Note
      </label>
      <textarea
        id="verdict-note"
        className="verdict-note"
        rows={2}
        maxLength={2000}
        placeholder={state === "needs_attention" ? "What needs a follow-up? (only you see this)" : "Add a note (optional)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && state) void save(state);
        }}
      />
      <div className="verdict-foot">
        {dirty && (
          <button type="button" className="btn primary" onClick={() => void save(state)} disabled={saving}>
            Save note
          </button>
        )}
        {!state && !msg && <span className="muted">Not reviewed yet. Pick one when you have looked through it.</span>}
        {msg && (
          <span className={msg.tone === "ok" ? "state ok" : "state warn"} key={pop} role="status">
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}

/** Risk flags grouped by kind; each one jumps to its step. */
export function RiskPanel({ steps, onPick }: { steps: Step[]; onPick: (seq: number) => void }) {
  const groups = riskFlagsOf(steps);
  if (groups.length === 0)
    return (
      <section className="panel risk-panel calm" aria-labelledby="risk-h">
        <div className="panel-h">
          <h2 id="risk-h">Risk flags</h2>
        </div>
        <p className="muted">Nothing risky found: no destructive commands, no secrets printed, no edits outside the project.</p>
      </section>
    );
  return (
    <section className="panel risk-panel" aria-labelledby="risk-h">
      <div className="panel-h">
        <h2 id="risk-h">Risk flags</h2>
        <span className="count">{groups.reduce((n, g) => n + g.items.length, 0)}</span>
      </div>
      <ul className="risk-groups">
        {groups.map((g, gi) => (
          <li key={g.kind} style={{ ["--i" as string]: gi }}>
            <span className="risk-kind">{g.label}</span>
            <ul className="risk-items">
              {g.items.slice(0, 4).map((it, i) => (
                <li key={`${it.seq}-${i}`}>
                  <button type="button" className={`risk-item sev-${it.flag.severity}`} onClick={() => onPick(it.seq)}>
                    <span className="risk-seq">#{it.seq}</span>
                    <span className="risk-reason">{it.flag.reason}</span>
                  </button>
                </li>
              ))}
              {g.items.length > 4 && <li className="muted risk-more">and {g.items.length - 4} more</li>}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The branch and the commits the agent made. */
export function GitPanel({ branch, commits, onPick }: { branch?: string | undefined; commits: Commit[]; onPick: (seq: number) => void }) {
  if (!branch && commits.length === 0) return null;
  return (
    <section className="panel git-panel" aria-labelledby="git-h">
      <div className="panel-h">
        <h2 id="git-h">Git</h2>
        {branch && (
          <span className="branch-chip" title="The branch when the session started">
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="4.5" cy="3.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="4.5" cy="12.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="11.5" cy="5.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4.5 5.3v5.4M11.5 7.3c0 2.5-3 2.5-6.2 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {branch}
          </span>
        )}
      </div>
      {commits.length === 0 ? (
        <p className="muted">No commits in this session.</p>
      ) : (
        <ul className="commits">
          {commits.map((c, i) => (
            <li key={c.sha + i} style={{ ["--i" as string]: i }}>
              <button type="button" className="commit" onClick={() => onPick(c.seq)}>
                <span className="commit-sha">{c.sha.slice(0, 7)}</span>
                <span className="commit-msg">{c.message}</span>
                {c.branch !== branch && <span className="muted commit-branch">{c.branch}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Every edit, file by file, as a combined diff. */
export function ChangesView({ steps, root, onPick }: { steps: Step[]; root: string; onPick: (seq: number) => void }) {
  const files = changesByFile(steps, root);
  const [open, setOpen] = useState<Set<string>>(() => new Set(files.slice(0, 3).map((f) => f.path)));
  if (files.length === 0) return <p className="muted-block">No files were changed in this session.</p>;
  const totalAdd = files.reduce((n, f) => n + f.added, 0);
  const totalDel = files.reduce((n, f) => n + f.removed, 0);
  const toggle = (p: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  return (
    <div className="changes">
      <div className="changes-head">
        <span>
          {files.length} file{files.length === 1 ? "" : "s"} changed
        </span>
        <span className="diff-add">+{totalAdd}</span>
        <span className="diff-del">−{totalDel}</span>
        <span className="grow"></span>
        <button type="button" className="link-btn" onClick={() => setOpen(new Set(files.map((f) => f.path)))}>
          Expand all
        </button>
        <button type="button" className="link-btn" onClick={() => setOpen(new Set())}>
          Collapse all
        </button>
      </div>
      {files.map((f, i) => (
        <FileDiff key={f.path} f={f} open={open.has(f.path)} onToggle={() => toggle(f.path)} onPick={onPick} order={i} />
      ))}
    </div>
  );
}

function FileDiff({ f, open, onToggle, onPick, order }: { f: FileChange; open: boolean; onToggle: () => void; onPick: (seq: number) => void; order: number }) {
  const total = f.added + f.removed;
  const blocks = 5;
  const addBlocks = total ? Math.round((f.added / total) * blocks) : 0;
  return (
    <section className={`file-diff enter${open ? " open" : ""}`} style={{ ["--enter-delay" as string]: `${Math.min(order, 10) * 40}ms` }}>
      <button type="button" className="file-diff-h" onClick={onToggle} aria-expanded={open}>
        <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="file-diff-path" title={f.path}>
          {f.rel}
        </span>
        <span className="file-diff-n">
          {f.edits.length} edit{f.edits.length === 1 ? "" : "s"}
        </span>
        <span className="diff-add">+{f.added}</span>
        <span className="diff-del">−{f.removed}</span>
        <span className="diff-blocks" aria-hidden="true">
          {Array.from({ length: blocks }, (_, i) => (
            <i key={i} className={total === 0 ? "" : i < addBlocks ? "a" : "d"}></i>
          ))}
        </span>
      </button>
      {open && (
        <div className="file-diff-body">
          {f.edits.map((e) => (
            <div key={e.seq} className={`hunk${e.failed ? " failed" : ""}`}>
              <div className="hunk-h">
                <button type="button" className="link-btn" onClick={() => onPick(e.seq)}>
                  step #{e.seq}
                </button>
                {e.full && <span className="tag">whole file written</span>}
                {e.failed && <span className="tag bad">did not apply</span>}
                {e.cut && <span className="muted">shortened here; open the step for all of it</span>}
              </div>
              <pre className="diff">
                {trimContext(e.lines).map((l, i) =>
                  l === null ? (
                    <span key={i} className="dl gap">
                      ⋯
                    </span>
                  ) : (
                    <span key={i} className={`dl ${l.kind}`}>
                      <span className="dl-sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                      {l.text || " "}
                    </span>
                  ),
                )}
              </pre>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Keep changed lines and three lines around them; long unchanged runs fold to a gap. */
function trimContext<T extends { kind: string }>(lines: T[], ctx = 3): (T | null)[] {
  const keep = lines.map(() => false);
  lines.forEach((l, i) => {
    if (l.kind === "same") return;
    for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) keep[k] = true;
  });
  if (!keep.some(Boolean)) return lines.slice(0, 40);
  const out: (T | null)[] = [];
  lines.forEach((l, i) => {
    if (keep[i]) out.push(l);
    else if (out[out.length - 1] !== null) out.push(null);
  });
  return out.slice(0, 600);
}

export const SHORTCUTS: [string, string][] = [
  ["j / k", "Next / previous step"],
  ["f", "Next failed step"],
  ["e", "Open or close the current step"],
  ["g", "Back to the top"],
  ["1 / 2 / 3", "Timeline, Changes, Files and commands"],
  ["a", "Mark as looks good"],
  ["n", "Mark as needs follow-up"],
  ["c", "Copy as PR summary"],
  ["?", "Show these shortcuts"],
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="kbd-overlay" role="dialog" aria-modal="true" aria-labelledby="kbd-h" onClick={onClose}>
      <div className="kbd-card" onClick={(e) => e.stopPropagation()}>
        <div className="panel-h">
          <h2 id="kbd-h">Keyboard shortcuts</h2>
          <button type="button" className="link-btn" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        <dl className="kbd-list">
          {SHORTCUTS.map(([k, v], i) => (
            <div key={k} style={{ ["--i" as string]: i }}>
              <dt>
                {k.split(" / ").map((x, j) => (
                  <span key={x}>
                    {j > 0 && <span className="muted"> / </span>}
                    <kbd>{x}</kbd>
                  </span>
                ))}
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
