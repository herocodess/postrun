import type { Metadata } from "next";
import { baseUrl } from "@/lib/env";
import { bytes, plural, relative, shortDate } from "@/lib/format";
import { requireViewer } from "@/lib/session";
import { listShares, listTokens, shareStatus } from "@/lib/shares";
import { CountUp } from "@/components/CountUp";
import { ShareActions } from "@/components/ShareActions";

export const metadata: Metadata = { title: "Share links" };
export const dynamic = "force-dynamic";

const STATUS_LABEL = { live: "Live", expired: "Expired", off: "Turned off" } as const;

export default async function Shares() {
  const v = await requireViewer("/shares");
  const [shares, tokens] = await Promise.all([listShares(v.id), listTokens(v.id)]);
  const now = new Date();
  const live = shares.filter((s) => shareStatus(s, now) === "live");
  const opens = shares.reduce((n, s) => n + s.opens, 0);
  const base = baseUrl();

  return (
    <div className="page">
      <div className="page-head rise">
        <div>
          <h1>Share links</h1>
          <p className="page-sub">Reports you chose to share. Each link is unlisted: only people you send it to can open it, and it stops working when it expires or you turn it off.</p>
        </div>
      </div>

      {shares.length === 0 ? (
        <Empty computers={tokens.map((t) => t.name)} />
      ) : (
        <>
          <div className="figs rise" style={{ ["--d" as string]: 1 }}>
            <div className="fig">
              <span className="fig-n">
                <CountUp value={live.length} />
              </span>
              <span className="fig-l">live {live.length === 1 ? "link" : "links"}</span>
            </div>
            <div className="fig">
              <span className="fig-n">
                <CountUp value={opens} />
              </span>
              <span className="fig-l">opens, all links</span>
            </div>
            <div className="fig">
              <span className="fig-n">
                <CountUp value={shares.length} />
              </span>
              <span className="fig-l">shared in total</span>
            </div>
          </div>

          <ul className="shares" aria-label="Your share links">
            {shares.map((s, i) => {
              const status = shareStatus(s, now);
              const url = `${base}/s/${s.id}`;
              return (
                <li key={s.id} className={`share is-${status}`} style={{ ["--i" as string]: Math.min(i, 12) }}>
                  <span className={`led led-${status}`} aria-hidden="true"></span>
                  <div className="share-main">
                    <div className="share-title">
                      {status === "live" ? (
                        <a href={url} target="_blank" rel="noreferrer">
                          {s.title}
                        </a>
                      ) : (
                        <span>{s.title}</span>
                      )}
                      {s.agent && <span className="badge mono">{s.agent}</span>}
                    </div>
                    <div className="share-meta">
                      <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
                      <span title={s.created_at.toISOString()}>Shared {shortDate(s.created_at)}</span>
                      <span title={s.expires_at.toISOString()}>
                        {status === "off" ? `Turned off ${relative(s.revoked_at!, now)}` : status === "expired" ? `Expired ${relative(s.expires_at, now)}` : `Expires ${relative(s.expires_at, now)}`}
                      </span>
                      <span>{bytes(s.size_bytes)}</span>
                    </div>
                  </div>
                  <div className="share-opens" title={s.last_opened_at ? `Last opened ${relative(s.last_opened_at, now)}` : "Not opened yet"}>
                    <span className="share-opens-n">{s.opens.toLocaleString("en-GB")}</span>
                    <span className="share-opens-l">{s.opens === 1 ? "open" : "opens"}</span>
                  </div>
                  <ShareActions id={s.id} url={url} live={status === "live"} title={s.title} />
                </li>
              );
            })}
          </ul>
          <p className="foot-note">
            {plural(shares.length, "link")}. Opens count each time the report loads, yours included. Turning a link off deletes the report from Postrun&apos;s servers straight away.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * First visit: a short checklist that ticks itself off, so it's clear the account is only one
 * part of Postrun, and what to do on the computer.
 */
function Empty({ computers }: { computers: string[] }) {
  const connected = computers.length > 0;
  const steps = [
    {
      done: connected,
      title: "Install Postrun on your computer",
      body: (
        <>
          It records your agents and opens the review app at <span className="mono">127.0.0.1:1234</span>. No account needed for this part.
          <code className="cmd">npm install -g postrun &amp;&amp; postrun setup</code>
        </>
      ),
    },
    {
      done: connected,
      title: connected ? `Computer connected: ${computers.slice(0, 2).join(", ")}${computers.length > 2 ? ` and ${computers.length - 2} more` : ""}` : "Connect it to this account",
      body: connected ? (
        <>It can now make share links as you. Manage it in <a href="/settings">Settings</a>.</>
      ) : (
        <>
          In the review app, open <strong className="t-plain">Settings → Account → Connect account</strong>. Or in a terminal:
          <code className="cmd">postrun login</code>
        </>
      ),
    },
    {
      done: false,
      title: "Share a session",
      body: (
        <>
          Open a session in the review app and click <strong className="t-plain">Share</strong>, or run <span className="mono">postrun share &lt;session id&gt;</span>. The link shows up here,
          with how many times it was opened.
        </>
      ),
    },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <section className="empty rise" style={{ ["--d" as string]: 1 }}>
      <div className="empty-art" aria-hidden="true">
        <span className="empty-step" style={{ ["--i" as string]: 0 }}></span>
        <span className="empty-step" style={{ ["--i" as string]: 1 }}></span>
        <span className="empty-step" style={{ ["--i" as string]: 2 }}></span>
        <span className="empty-link"></span>
      </div>
      <h2>Your first share link, in three steps</h2>
      <p className="muted">Postrun runs on your computer. This account is only for sending a session as a link, and Postrun redacts it first.</p>
      <ol className="checklist">
        {steps.map((st, i) => (
          <li key={i} className={st.done ? "done" : i === next ? "next" : ""} style={{ ["--i" as string]: i }}>
            <span className="check" aria-hidden="true">
              {st.done ? (
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path d="M3 7.4l2.6 2.6L11 4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <div>
              <div className="check-title">
                {st.title}
                {st.done && <span className="sr-only"> (done)</span>}
              </div>
              <div className="check-body">{st.body}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="empty-actions">
        <a className="btn btn-ghost btn-sm" href="http://127.0.0.1:1234/" target="_blank" rel="noreferrer">
          Open your review app
        </a>
        <a className="btn btn-quiet btn-sm" href="https://docs.postrun.app/share/">
          How share links work
        </a>
      </div>
    </section>
  );
}
