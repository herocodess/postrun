import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/env";
import { feedbackStats, FEEDBACK_SOURCES, listFeedback, type FeedbackFilter, type FeedbackSource } from "@/lib/feedback";
import { relative, shortDate } from "@/lib/format";
import { requireViewer } from "@/lib/session";
import { CountUp } from "@/components/CountUp";
import { FeedbackStatus } from "@/components/FeedbackStatus";
import { RATING_LABELS } from "@/lib/rating";

export const metadata: Metadata = { title: "Admin · Feedback" };
export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<FeedbackSource, string> = { "review-app": "Review app", cli: "Terminal", app: "app.postrun.app" };

/** Feedback from everyone, for the people listed in ADMIN_EMAILS. Anyone else gets a 404, as if it didn't exist. */
export default async function Admin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const v = await requireViewer("/admin");
  if (!isAdmin(v.email)) notFound();
  const q = await searchParams;
  const f: FeedbackFilter = {};
  if (typeof q["source"] === "string" && FEEDBACK_SOURCES.includes(q["source"] as FeedbackSource)) f.source = q["source"] as FeedbackSource;
  if (q["status"] === "new" || q["status"] === "done") f.status = q["status"];
  const r = Number(q["rating"]);
  if (Number.isInteger(r) && r >= 1 && r <= 5) f.rating = r;
  const [stats, rows] = await Promise.all([feedbackStats(), listFeedback(f)]);
  const maxBar = Math.max(1, ...Object.values(stats.ratings));
  const now = new Date();
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { source: f.source, status: f.status, rating: f.rating ? String(f.rating) : undefined, ...patch };
    for (const [k, val] of Object.entries(merged)) if (val) p.set(k, val);
    const s = p.toString();
    return `/admin${s ? `?${s}` : ""}`;
  };

  return (
    <div className="page">
      <div className="page-head rise">
        <div>
          <h1>Feedback</h1>
          <p className="page-sub">Everything people sent from the review app, the terminal and this site. Only the emails in ADMIN_EMAILS can see this page.</p>
        </div>
      </div>

      <div className="figs figs-4 rise" style={{ ["--d" as string]: 1 }}>
        <div className="fig">
          <span className="fig-n">{stats.average === null ? "–" : stats.average.toFixed(1)}</span>
          <span className="fig-l">average rating{stats.average_30 !== null ? `, ${stats.average_30.toFixed(1)} in 30 days` : ""}</span>
        </div>
        <div className="fig">
          <span className="fig-n">
            <CountUp value={stats.total} />
          </span>
          <span className="fig-l">{stats.last_30} in the last 30 days</span>
        </div>
        <div className="fig">
          <span className="fig-n">
            <CountUp value={stats.open} />
          </span>
          <span className="fig-l">not dealt with yet</span>
        </div>
        <div className="fig">
          <span className="fig-n">
            <CountUp value={stats.users} />
          </span>
          <span className="fig-l">different people</span>
        </div>
      </div>

      <section className="card rise dist" style={{ ["--d" as string]: 2 }} aria-label="Ratings">
        {([5, 4, 3, 2, 1] as const).map((n, i) => (
          <a key={n} href={link({ rating: f.rating === n ? undefined : String(n) })} className={`dist-row${f.rating === n ? " on" : ""}`}>
            <span className="dist-n mono">{n}</span>
            <span className="dist-l">{RATING_LABELS[n - 1]}</span>
            <span className="dist-bar">
              <span style={{ width: `${(stats.ratings[n] / maxBar) * 100}%`, ["--i" as string]: i }}></span>
            </span>
            <span className="dist-c mono">{stats.ratings[n]}</span>
          </a>
        ))}
      </section>

      <div className="filters rise" style={{ ["--d" as string]: 3 }}>
        <div className="seg">
          <a href={link({ status: undefined })} className={!f.status ? "on" : ""}>
            All
          </a>
          <a href={link({ status: "new" })} className={f.status === "new" ? "on" : ""}>
            Open
          </a>
          <a href={link({ status: "done" })} className={f.status === "done" ? "on" : ""}>
            Done
          </a>
        </div>
        <div className="seg">
          <a href={link({ source: undefined })} className={!f.source ? "on" : ""}>
            Everywhere
          </a>
          {FEEDBACK_SOURCES.map((s) => (
            <a key={s} href={link({ source: s })} className={f.source === s ? "on" : ""}>
              {SOURCE_LABEL[s]}
            </a>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="empty-line rise">Nothing here yet{f.source || f.status || f.rating ? " with these filters" : ""}.</p>
      ) : (
        <ul className="fb-list" aria-label="Feedback">
          {rows.map((row, i) => {
            const from = row.email ?? row.account_email;
            return (
              <li key={row.id} id={row.id} className={`fb-item is-${row.status}`} style={{ ["--i" as string]: Math.min(i, 12) }}>
                <div className="fb-item-head">
                  {row.rating ? (
                    <span className={`fb-score s${row.rating}`} title={RATING_LABELS[row.rating - 1]}>
                      {row.rating}
                      <small>/5</small>
                    </span>
                  ) : (
                    <span className="fb-score none">–</span>
                  )}
                  <div className="fb-who">
                    <div>{from ? <a href={`mailto:${from}`}>{from}</a> : <span className="muted">No email</span>}</div>
                    <div className="muted small">
                      {SOURCE_LABEL[row.source]}
                      {row.version ? ` · ${row.version}` : ""}
                      {row.platform ? ` · ${row.platform}` : ""} · <span title={row.created_at.toISOString()}>{relative(row.created_at, now)}</span>, {shortDate(row.created_at)}
                    </div>
                  </div>
                  <FeedbackStatus id={row.id} status={row.status} />
                </div>
                {row.message && <p className="fb-msg">{row.message}</p>}
                {row.usage && (
                  <details className="fb-usage">
                    <summary>Usage summary they attached</summary>
                    <pre>{row.usage}</pre>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
