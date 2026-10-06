"use client";

/**
 * Settings > Your usage: how often Postrun's features are used, counted on this computer only.
 * Nothing is sent anywhere; Copy summary puts the same plain text `postrun stats` prints on the
 * clipboard, for someone who chooses to share it.
 */

import { useEffect, useState } from "react";
import type { UsageEvent, UsageResponse } from "@postrun/core/server/api";
import { api, apiFetch, DEMO } from "@/lib/api";
import { CountUp } from "@/lib/motion";

/** The features worth a figure of their own; the rest are in the list below. */
const FIGURES: Array<[UsageEvent, string]> = [
  ["review_marked", "reviews marked"],
  ["pr_summary_copied", "PR summaries copied"],
  ["report_exported", "reports exported"],
  ["search", "searches"],
];

const LABELS: Record<UsageEvent, string> = {
  app_opened: "Opened the review app",
  session_viewed: "Looked at a session",
  review_marked: "Marked a review",
  pr_summary_copied: "Copied a PR summary",
  changes_viewed: "Opened the Changes tab",
  report_exported: "Exported a report",
  reports_zipped: "Exported several as a zip",
  search: "Searched sessions",
  keyboard_used: "Used keyboard shortcuts",
  backup_saved: "Saved a backup",
};

export function UsageCard() {
  const [u, setU] = useState<UsageResponse | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(api.usage())
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as UsageResponse;
      })
      .then((x) => !cancelled && setU(x))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = async () => {
    if (!u) return;
    try {
      await navigator.clipboard.writeText(u.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked: the text is still in postrun stats
    }
  };

  const max = Math.max(1, ...(u?.daily.map((d) => d.actions) ?? [1]));
  return (
    <section id="usage" className="set-card usage-card" aria-labelledby="usage-h">
      <h2 id="usage-h">Your usage</h2>
      <div className="set-row">
        <div className="set-text">
          <div className="set-title">Counted on this computer only</div>
          <div className="set-note">
            How often you use each feature, as numbers: no sessions, paths or text. Postrun never sends them anywhere. To share them, copy the summary, or run <code>postrun stats</code>.
            {DEMO ? " These are example numbers." : ""}
          </div>
        </div>
        <div className="set-control">
          <button type="button" className={`btn${copied ? " ok" : ""}`} onClick={() => void copy()} disabled={!u}>
            {copied ? "Copied" : "Copy summary"}
          </button>
        </div>
      </div>

      {failed ? (
        <p className="set-note usage-pad">Usage counts are not available here.</p>
      ) : !u ? (
        <div className="usage-pad" aria-busy="true">
          <span className="sk" style={{ height: 64 }}></span>
        </div>
      ) : (
        <div className="usage-body">
          <div className="usage-figs">
            <div className="usage-fig">
              <span className="usage-fig-n">
                <CountUp value={u.days_active_30} />
                <span className="muted"> / 30</span>
              </span>
              <span className="usage-fig-l">days active</span>
            </div>
            <div className="usage-fig">
              <span className="usage-fig-n">
                <CountUp value={u.sessions.last_30} />
              </span>
              <span className="usage-fig-l">sessions recorded</span>
            </div>
            {FIGURES.map(([e, label]) => (
              <div key={e} className="usage-fig">
                <span className="usage-fig-n">
                  <CountUp value={u.events[e].last_30} />
                </span>
                <span className="usage-fig-l">{label}</span>
              </div>
            ))}
          </div>

          <div className="usage-days" role="img" aria-label={`Active on ${u.days_active_30} of the last 30 days`}>
            {u.daily.map((d, i) => (
              <span
                key={d.day}
                className={`usage-day${d.opened ? " on" : ""}`}
                style={{ ["--i" as string]: i, ["--level" as string]: d.opened ? 0.35 + 0.65 * (d.actions / max) : 0 }}
                title={`${new Date(`${d.day}T12:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}: ${d.opened ? `${d.actions} feature use${d.actions === 1 ? "" : "s"}` : "not opened"}`}
              ></span>
            ))}
          </div>
          <div className="usage-days-x">
            <span>30 days ago</span>
            <span>today</span>
          </div>

          <table className="usage-table">
            <thead>
              <tr>
                <th scope="col">Feature</th>
                <th scope="col" className="num">
                  Last 30 days
                </th>
                <th scope="col" className="num">
                  All time
                </th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(LABELS) as UsageEvent[]).map((e) => (
                <tr key={e} className={u.events[e].total === 0 ? "unused" : ""}>
                  <td>{LABELS[e]}</td>
                  <td className="num">{u.events[e].last_30}</td>
                  <td className="num">{u.events[e].total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="set-note">{u.since ? `Counting since ${new Date(`${u.since}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })}.` : "Nothing counted yet."} Delete everything in Storage clears these too.</p>
        </div>
      )}
    </section>
  );
}
