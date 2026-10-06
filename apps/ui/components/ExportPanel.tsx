"use client";

/**
 * Export flow: show what redaction will mask, then download. The download is
 * the same file `postrun export` writes; redaction cannot be switched off.
 */

import { useEffect, useRef, useState } from "react";
import type { AccountResponse, ApiError, ExportReviewResponse, SecretKind, ShareResponse } from "@postrun/core/server/api";
import { Loader } from "@postrun/brand/logo";
import { api, apiFetch, DEMO } from "@/lib/api";
import { startConnect } from "@/lib/account";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: ExportReviewResponse };

// Typed against the redactor's kinds, so a new kind cannot ship without a label here.
const KIND_LABEL: Record<SecretKind, string> = {
  "private-key": "private key",
  "aws-access-key": "AWS key",
  "github-token": "GitHub token",
  "anthropic-key": "Anthropic key",
  "openai-key": "OpenAI key",
  "stripe-key": "Stripe key",
  "slack-token": "Slack token",
  "google-api-key": "Google API key",
  jwt: "JWT",
  "gitlab-token": "GitLab token",
  "npm-token": "npm token",
  "huggingface-token": "Hugging Face token",
  "sendgrid-key": "SendGrid key",
  "google-oauth-secret": "Google OAuth secret",
  "webhook-url": "webhook URL",
  "url-password": "URL password",
  "auth-header": "auth header",
  cookie: "cookie",
  credential: "credential",
  "high-entropy": "random-looking value",
  email: "email address",
};

export function ExportPanel({ sessionId, onClose, focusShare = false }: { sessionId: string; onClose: () => void; focusShare?: boolean }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const reviewUrl = api.exportReview(sessionId);
  const downloadUrl = api.exportDownload(sessionId);

  useEffect(() => {
    let cancelled = false;
    apiFetch(reviewUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET ${reviewUrl} -> ${res.status}`);
        return (await res.json()) as ExportReviewResponse;
      })
      .then((data) => !cancelled && setState({ kind: "ready", data }))
      .catch((err: unknown) => !cancelled && setState({ kind: "error", message: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, [reviewUrl]);

  return (
    <section className="export-panel" aria-label="Export report">
      <div className="export-head">
        <h2>Export report</h2>
        <span className="sub">one HTML file, no scripts, opens anywhere</span>
        <span className="spacer"></span>
        <button type="button" className="btn ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {state.kind === "loading" && (
        <div className="panel-loader">
          <Loader size={24} label="Checking what to redact" />
        </div>
      )}
      {state.kind === "error" && <p className="error">Could not prepare the export: {state.message}</p>}
      {state.kind === "ready" && <Review data={state.data} href={downloadUrl} />}
      {state.kind === "ready" && <ShareLink sessionId={sessionId} focus={focusShare} />}
    </section>
  );
}

function Review({ data, href }: { data: ExportReviewResponse; href: string }) {
  const { findings, home_paths } = data.redaction;
  return (
    <>
      <p className={`export-summary ${findings.length ? "warn" : ""}`}>
        {findings.length === 0
          ? "No secrets detected."
          : `${findings.length} value${findings.length === 1 ? "" : "s"} will be masked. Check each one below.`}
        {home_paths > 0 && ` ${home_paths} home path${home_paths === 1 ? "" : "s"} will show as ~.`} The machine name, capture paths, and your review notes are left out.
      </p>

      {findings.length > 0 && (
        <div className="findings">
          {findings.map((f, i) => (
            <div className="finding" key={i}>
              <span className="fkind">{KIND_LABEL[f.kind] ?? f.kind}</span>
              <span className="floc">{f.location}</span>
              <code className="fctx">{f.context}</code>
            </div>
          ))}
        </div>
      )}

      <div className="export-actions">
        <a className="btn primary" href={href} download={data.filename}>
          Download {data.filename} ({Math.max(1, Math.round(data.bytes / 1024))} KB)
        </a>
        <span className="muted">Redaction is automatic, not a guarantee. Skim the report before you send it.</span>
      </div>
    </>
  );
}

const EXPIRY = [1, 7, 30, 90] as const;

type ShareState =
  | { kind: "loading" }
  | { kind: "demo" }
  | { kind: "signed-out"; server: string }
  | { kind: "ready"; account: AccountResponse }
  | { kind: "making"; account: AccountResponse }
  | { kind: "made"; account: AccountResponse; link: ShareResponse }
  | { kind: "error"; account: AccountResponse; message: string };

/**
 * A link instead of a file: the same redacted report, uploaded to app.postrun.app by the
 * background process with this computer's sign-in. Only on purpose, one session at a time.
 */
function ShareLink({ sessionId, focus }: { sessionId: string; focus: boolean }) {
  const [s, setS] = useState<ShareState>(DEMO ? { kind: "demo" } : { kind: "loading" });
  const [connecting, setConnecting] = useState<string>();
  const box = useRef<HTMLDivElement>(null);
  // Opened with the Share button: bring the share part into view.
  useEffect(() => {
    if (focus) box.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);
  const [days, setDays] = useState<(typeof EXPIRY)[number]>(30);
  const [copied, setCopied] = useState(false);

  const load = () => {
    if (DEMO) return;
    apiFetch(api.account())
      .then(async (r) => (r.ok ? ((await r.json()) as AccountResponse) : { signed_in: false, server: "https://app.postrun.app" }))
      .then((a) => setS(a.signed_in ? { kind: "ready", account: a } : { kind: "signed-out", server: a.server }))
      .catch(() => setS({ kind: "signed-out", server: "https://app.postrun.app" }));
  };
  useEffect(load, []);

  async function make(account: AccountResponse) {
    setS({ kind: "making", account });
    try {
      const r = await apiFetch(api.share(sessionId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expires_days: days }) });
      if (r.status === 409) return setS({ kind: "signed-out", server: account.server });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({ error: `${r.status}` }))) as ApiError;
        return setS({ kind: "error", account, message: e.error });
      }
      setS({ kind: "made", account, link: (await r.json()) as ShareResponse });
    } catch (e) {
      setS({ kind: "error", account, message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked: the link is selectable
    }
  }

  const manage = (server: string) => `${server}/shares`;

  return (
    <div className="share-box" ref={box}>
      <div className="share-box-head">
        <h3>Share link</h3>
        <span className="sub">the same redacted report, as an unlisted link that expires</span>
      </div>
      {s.kind === "loading" && <Loader size={18} inline label="Checking this computer's sign-in" />}
      {s.kind === "demo" && <p className="muted">In your own Postrun, this uploads the report above and gives you a link to send.</p>}
      {s.kind === "signed-out" && (
        <div className="share-signin">
          {connecting ? (
            <>
              <Loader size={18} inline label="Waiting for the browser" />
              <p className="muted">
                Approve this computer in the tab that opened, and this updates by itself.{" "}
                <a href={connecting} target="_blank" rel="noreferrer">
                  Didn&apos;t open?
                </a>
              </p>
            </>
          ) : (
            <>
              <p className="muted">Share links need a free Postrun account, connected to this computer once. Recording never does.</p>
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  void startConnect((a) => {
                    setConnecting(undefined);
                    setS(a.signed_in ? { kind: "ready", account: a } : { kind: "signed-out", server: a.server });
                  }).then(
                    (c) => setConnecting(c.url),
                    () => setS({ kind: "signed-out", server: s.server }),
                  )
                }
              >
                Connect account
              </button>
            </>
          )}
        </div>
      )}
      {(s.kind === "ready" || s.kind === "making" || s.kind === "error") && (
        <>
          <div className="share-make">
            <span className="muted">Link works for</span>
            <div className="seg" role="group" aria-label="Link works for">
              {EXPIRY.map((d) => (
                <button key={d} type="button" className={d === days ? "on" : ""} aria-pressed={d === days} onClick={() => setDays(d)} disabled={s.kind === "making"}>
                  {d === 1 ? "1 day" : `${d} days`}
                </button>
              ))}
            </div>
            <button type="button" className="btn primary" onClick={() => void make(s.account)} disabled={s.kind === "making"}>
              {s.kind === "making" ? (
                <>
                  <Loader size={15} inline label="Uploading" /> Uploading…
                </>
              ) : (
                "Create link"
              )}
            </button>
          </div>
          <p className="muted small-note">
            Uploads to {s.account.server.replace(/^https?:\/\//, "")} as {s.account.email ?? "you"}. Anyone with the link can open it until it expires or you turn it off.
          </p>
          {s.kind === "error" && <p className="error">{s.message}</p>}
        </>
      )}
      {s.kind === "made" && (
        <div className="share-made">
          <div className="share-url">
            <input readOnly value={s.link.url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className={`btn primary${copied ? " ok" : ""}`} onClick={() => void copy(s.link.url)}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="muted small-note">
            Expires {new Date(s.link.expires_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}.{" "}
            <a href={manage(s.account.server)} target="_blank" rel="noreferrer">
              See opens or turn it off
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
