import type { Metadata } from "next";
import { Mark } from "@postrun/brand/logo";
import { relative } from "@/lib/format";
import { isShareId } from "@/lib/ids";
import { shareForViewer, shareStatus } from "@/lib/shares";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared session report",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * A shared report: a thin Postrun bar on top, the report below in a sandboxed
 * frame (see ./report/route.ts). Anyone with the link can open it, signed in or
 * not. Nothing about who shared it is shown.
 */
export default async function SharedReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = isShareId(id) ? await shareForViewer(id) : undefined;
  const status = s ? shareStatus(s) : undefined;
  const ok = s && status === "live" && s.available;

  if (!ok) {
    return (
      <div className="auth">
        <main className="auth-main">
          <section className="auth-card gone">
            <Mark size={36} />
            <h1>{status === "expired" ? "This link has expired" : status === "off" ? "This link was turned off" : "This link doesn't exist"}</h1>
            <p className="auth-sub">
              {s ? "The person who shared it can send you a new one." : "Check you have the whole link. Share links are long and easy to cut short."}
            </p>
            <a className="btn btn-ghost" href="https://postrun.app">
              What is Postrun?
            </a>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="viewer">
      <header className="viewer-bar">
        <a href="https://postrun.app" className="viewer-brand" target="_blank" rel="noreferrer" aria-label="Postrun">
          <Mark size={20} animated />
        </a>
        <div className="viewer-title">
          <span className="viewer-kicker mono">Shared session report</span>
          <span className="viewer-name">{s.title}</span>
        </div>
        <span className="viewer-exp mono" title={s.expires_at.toISOString()}>
          Link expires {relative(s.expires_at)}
        </span>
        <a
          className="viewer-report"
          href={`mailto:hm@heromomoh.com?subject=${encodeURIComponent(`Report a Postrun link: ${s.id}`)}`}
          title="Postrun reports never ask you to sign in or enter anything. If this one does, tell us."
        >
          Report
        </a>
        <a className="btn btn-sm btn-ghost viewer-cta" href="https://postrun.app" target="_blank" rel="noreferrer">
          Get Postrun
        </a>
      </header>
      <iframe className="viewer-frame" src={`/s/${s.id}/report`} title={`Report: ${s.title}`} sandbox="" referrerPolicy="no-referrer"></iframe>
    </div>
  );
}
