"use client";

/**
 * Feedback, sent on purpose. The dialog shows exactly what will be sent before
 * Send; the background process passes it to app.postrun.app. The usage summary
 * (counts only, as in Settings) goes only when the box is ticked.
 *
 * FeedbackPrompt asks once, gently, after about a week of real use, and stays
 * away for two months after it is dismissed (three after feedback is sent).
 */

import { useEffect, useRef, useState } from "react";
import type { AccountResponse, ApiError, UsageResponse } from "@postrun/core/server/api";
import { Loader } from "@postrun/brand/logo";
import { api, apiFetch, DEMO } from "@/lib/api";
import { Rating } from "./Rating";

const SENT_KEY = "postrun.feedback.sent";
const DISMISSED_KEY = "postrun.feedback.dismissed";
const DAY = 86_400_000;

function remember(key: string) {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    /* storage blocked: the prompt may come back, which is fine */
  }
}

function since(key: string): number | undefined {
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0 ? Date.now() - v : undefined;
  } catch {
    return undefined;
  }
}

type State = { kind: "editing" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [rating, setRating] = useState<number>();
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [usage, setUsage] = useState(false);
  const [usageText, setUsageText] = useState<string>();
  const [state, setState] = useState<State>({ kind: "editing" });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (DEMO) return;
    apiFetch(api.account())
      .then(async (r) => (r.ok ? ((await r.json()) as AccountResponse) : undefined))
      .then((a) => a?.email && setEmail((e) => e || a.email || ""))
      .catch(() => undefined);
    apiFetch(api.usage())
      .then(async (r) => (r.ok ? ((await r.json()) as UsageResponse) : undefined))
      .then((u) => u && setUsageText(u.text))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("[role=radio]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !box.current) return;
      // Keep focus inside the dialog.
      const f = [...box.current.querySelectorAll<HTMLElement>("button, input, textarea, a[href], [tabindex='0']")].filter((el) => !el.hasAttribute("disabled"));
      if (f.length === 0) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  async function send() {
    if (DEMO) {
      setState({ kind: "sent" });
      return;
    }
    setState({ kind: "sending" });
    try {
      const r = await apiFetch(api.feedback(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(rating ? { rating } : {}), message, email, include_usage: usage }),
      });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({ error: `${r.status}` }))) as ApiError;
        setState({ kind: "error", message: e.error });
        return;
      }
      remember(SENT_KEY);
      setState({ kind: "sent" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const busy = state.kind === "sending";
  const canSend = (rating !== undefined || message.trim().length > 0) && !busy;

  return (
    <div className="fb-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fb-dialog" role="dialog" aria-modal="true" aria-labelledby="fb-h" ref={box}>
        {state.kind === "sent" ? (
          <div className="fb-thanks" role="status">
            <svg width="48" height="48" viewBox="0 0 44 44" fill="none" aria-hidden="true">
              <circle cx="22" cy="22" r="20" stroke="var(--success)" strokeWidth="2" className="fb-ring" />
              <path d="M14 22.5l5.5 5.5L30 17" stroke="var(--success)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="fb-tick" />
            </svg>
            <h2 id="fb-h">Thank you</h2>
            <p>{DEMO ? "In your own Postrun, this goes straight to the team." : "It went straight to the Postrun team, and every piece is read."}</p>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="fb-head">
              <h2 id="fb-h">Send feedback</h2>
              <button type="button" className="fb-x" onClick={onClose} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <p className="fb-sub">What you say decides what Postrun does next. Nothing about your sessions is sent.</p>

            <div className="fb-field">
              <span className="fb-q">How useful is Postrun to you?</span>
              <Rating value={rating} onChange={setRating} disabled={busy} />
            </div>

            <label className="fb-field">
              <span className="fb-q">What should Postrun do next?</span>
              <textarea rows={4} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Anything missing, confusing or broken." disabled={busy} />
            </label>

            <label className="fb-field">
              <span className="fb-q">
                Email <span className="muted">(optional, for a reply)</span>
              </span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" disabled={busy} />
            </label>

            <label className="fb-check">
              <input type="checkbox" checked={usage} onChange={(e) => setUsage(e.target.checked)} disabled={busy} />
              <span>
                Attach my usage summary <span className="muted">(counts only, as in Settings)</span>
              </span>
            </label>

            <details className="fb-preview">
              <summary>Exactly what will be sent</summary>
              <dl>
                <dt>Rating</dt>
                <dd>{rating ? `${rating} of 5` : "None"}</dd>
                <dt>Message</dt>
                <dd className="pre">{message.trim() || "None"}</dd>
                <dt>Email</dt>
                <dd>{email.trim() || "None"}</dd>
                <dt>Also</dt>
                <dd>Your Postrun version and system (for example macOS on Apple silicon)</dd>
                <dt>Usage</dt>
                <dd className="pre">{usage ? (usageText ?? "Loading…") : "Not attached"}</dd>
              </dl>
            </details>

            {state.kind === "error" && (
              <p className="fb-err" role="alert">
                Couldn&apos;t send it: {state.message}
              </p>
            )}

            <div className="fb-actions">
              <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={() => void send()} disabled={!canSend}>
                {busy ? (
                  <>
                    <Loader size={15} inline label="Sending" /> Sending…
                  </>
                ) : (
                  "Send feedback"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A one-time nudge after about a week of real use. Never in the demo, never twice in two months. */
export function FeedbackPrompt({ onOpen }: { onOpen: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (DEMO) return;
    const sent = since(SENT_KEY);
    const dismissed = since(DISMISSED_KEY);
    if ((sent !== undefined && sent < 90 * DAY) || (dismissed !== undefined && dismissed < 60 * DAY)) return;
    apiFetch(api.usage())
      .then(async (r) => (r.ok ? ((await r.json()) as UsageResponse) : undefined))
      .then((u) => {
        if (!u?.since) return;
        const age = Date.now() - new Date(`${u.since}T00:00:00`).getTime();
        if (age >= 7 * DAY && u.events.session_viewed.total >= 5) setShow(true);
      })
      .catch(() => undefined);
  }, []);
  if (!show) return null;
  const dismiss = () => {
    remember(DISMISSED_KEY);
    setShow(false);
  };
  return (
    <aside className="fb-prompt" role="status">
      <span className="fb-prompt-mark" aria-hidden="true"></span>
      <span>
        <b>How&apos;s Postrun working for you?</b> A number and a sentence help decide what comes next.
      </span>
      <button
        type="button"
        className="btn primary"
        onClick={() => {
          dismiss();
          onOpen();
        }}
      >
        Tell us
      </button>
      <button type="button" className="link-btn" onClick={dismiss}>
        Not now
      </button>
    </aside>
  );
}
