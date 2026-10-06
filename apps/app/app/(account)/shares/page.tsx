import type { Metadata } from "next";
import { baseUrl } from "@/lib/env";
import { bytes, plural, relative, shortDate } from "@/lib/format";
import { requireViewer } from "@/lib/session";
import { listShares, shareStatus } from "@/lib/shares";
import { CountUp } from "@/components/CountUp";
import { ShareActions } from "@/components/ShareActions";

export const metadata: Metadata = { title: "Share links" };
export const dynamic = "force-dynamic";

const STATUS_LABEL = { live: "Live", expired: "Expired", off: "Turned off" } as const;

export default async function Shares() {
  const v = await requireViewer("/shares");
  const shares = await listShares(v.id);
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
        <Empty />
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

function Empty() {
  return (
    <section className="empty rise" style={{ ["--d" as string]: 1 }}>
      <div className="empty-art" aria-hidden="true">
        <span className="empty-step" style={{ ["--i" as string]: 0 }}></span>
        <span className="empty-step" style={{ ["--i" as string]: 1 }}></span>
        <span className="empty-step" style={{ ["--i" as string]: 2 }}></span>
        <span className="empty-link"></span>
      </div>
      <h2>No share links yet</h2>
      <p className="muted">Sharing happens from your own machine, one session at a time. Postrun redacts the report first and shows you what it masked.</p>
      <div className="empty-actions">
        <a className="btn btn-ghost btn-sm" href="http://127.0.0.1:1234/" target="_blank" rel="noreferrer">
          Open your review app
        </a>
        <a className="btn btn-quiet btn-sm" href="https://docs.postrun.app/quickstart/">
          Don&apos;t have Postrun yet?
        </a>
      </div>
      <ol className="steps">
        <li>
          <span className="step-n">1</span>
          <div>
            Connect this account to your computer: <strong className="t-plain">Connect account</strong> in the review app&apos;s Settings, or in a terminal:
            <code className="cmd">postrun login</code>
          </div>
        </li>
        <li>
          <span className="step-n">2</span>
          <div>
            Open a session in the review app and choose <strong className="t-plain">Share link</strong>, or run:
            <code className="cmd">postrun share &lt;session id&gt;</code>
          </div>
        </li>
        <li>
          <span className="step-n">3</span>
          <div>The link appears here, with how many times it was opened.</div>
        </li>
      </ol>
    </section>
  );
}
