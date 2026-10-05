"use client";

/**
 * Export flow: show what redaction will mask, then download. The download is
 * the same file `pnpm export` writes; redaction cannot be switched off.
 */

import { useEffect, useState } from "react";
import type { ExportReviewResponse } from "@postrun/core/server/api";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: ExportReviewResponse };

const KIND_LABEL: Record<string, string> = {
  "private-key": "private key",
  "aws-access-key": "AWS key",
  "github-token": "GitHub token",
  "anthropic-key": "Anthropic key",
  "openai-key": "OpenAI key",
  "stripe-key": "Stripe key",
  "slack-token": "Slack token",
  "google-api-key": "Google API key",
  jwt: "JWT",
  "url-password": "URL password",
  "auth-header": "auth header",
  credential: "credential",
};

export function ExportPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const base = `/api/sessions/${encodeURIComponent(sessionId)}/export`;

  useEffect(() => {
    let cancelled = false;
    fetch(`${base}/review`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET ${base}/review -> ${res.status}`);
        return (await res.json()) as ExportReviewResponse;
      })
      .then((data) => !cancelled && setState({ kind: "ready", data }))
      .catch((err: unknown) => !cancelled && setState({ kind: "error", message: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, [base]);

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

      {state.kind === "loading" && <p className="muted">Checking what to redact…</p>}
      {state.kind === "error" && <p className="error">Could not prepare the export: {state.message}</p>}
      {state.kind === "ready" && <Review data={state.data} href={base} />}
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
