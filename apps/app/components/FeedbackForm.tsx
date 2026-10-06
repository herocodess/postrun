"use client";

import { useState, useTransition } from "react";
import { Loader } from "@postrun/brand/logo";
import { sendFeedback } from "@/app/(account)/actions";
import { Rating } from "./Rating";

export function FeedbackForm({ email }: { email: string }) {
  const [rating, setRating] = useState<number>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  if (sent)
    return (
      <div className="fb-thanks" role="status">
        <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
          <circle cx="22" cy="22" r="20" stroke="var(--ok)" strokeWidth="2" className="fb-ring" />
          <path d="M14 22.5l5.5 5.5L30 17" stroke="var(--ok)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="fb-tick" />
        </svg>
        <h2>Thank you</h2>
        <p className="muted">It went straight to Hero, who reads every one. If you asked something, the reply comes to {email}.</p>
        <button type="button" className="link-btn" onClick={() => (setSent(false), setRating(undefined), setMessage(""))}>
          Send more
        </button>
      </div>
    );

  return (
    <form
      className="fb-form"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await sendFeedback({ ...(rating ? { rating } : {}), message });
          if (r.error) setError(r.error);
          else setSent(true);
        });
      }}
    >
      <label className="fb-q">How useful is Postrun to you?</label>
      <Rating value={rating} onChange={setRating} disabled={pending} />
      <label className="fb-q" htmlFor="fb-msg">
        What should Postrun do next? <span className="muted">Anything missing, confusing or broken.</span>
      </label>
      <textarea id="fb-msg" rows={6} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="I'd love it if Postrun could…" disabled={pending} />
      <div className="fb-foot">
        <span className="muted small">Sent with your email, {email}, so a reply can reach you.</span>
        <button type="submit" className="btn btn-primary" disabled={pending || (!rating && !message.trim())}>
          {pending ? (
            <>
              <Loader size={16} inline label="Sending" /> Sending…
            </>
          ) : (
            "Send feedback"
          )}
        </button>
      </div>
      {error && (
        <p className="form-err" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
