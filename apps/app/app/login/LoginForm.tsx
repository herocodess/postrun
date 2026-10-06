"use client";

import { useState, type FormEvent } from "react";
import { Mark } from "@postrun/brand/logo";
import { authClient } from "@/lib/auth-client";

type State = { kind: "idle" } | { kind: "pending"; via: "github" | "email" } | { kind: "sent"; email: string } | { kind: "error"; message: string };

/**
 * One page for signing in and creating an account: both ways in create the
 * account the first time. No passwords.
 */
export function LoginForm({ next, error, cli }: { next: string; error?: string | undefined; cli: boolean }) {
  const [state, setState] = useState<State>(error ? { kind: "error", message: error } : { kind: "idle" });
  const errorURL = `/login?next=${encodeURIComponent(next)}`;

  async function github() {
    setState({ kind: "pending", via: "github" });
    const r = await authClient.signIn.social({ provider: "github", callbackURL: next, errorCallbackURL: errorURL });
    // On success the browser is already on its way to GitHub.
    if (r.error) setState({ kind: "error", message: r.error.message ?? "GitHub sign-in didn't start. Try again." });
  }

  async function email(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const address = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    if (!address) return;
    setState({ kind: "pending", via: "email" });
    const r = await authClient.signIn.magicLink({ email: address, callbackURL: next, errorCallbackURL: errorURL });
    if (r.error) {
      const slow = r.error.status === 429;
      setState({ kind: "error", message: slow ? "Too many sign-in emails. Wait a minute, then try again." : (r.error.message ?? "We couldn't send the email. Try again.") });
      return;
    }
    setState({ kind: "sent", email: address });
  }

  const busy = state.kind === "pending";

  if (state.kind === "sent") {
    return (
      <section className="auth-card auth-sent" aria-live="polite">
        <div className="sent-icon" aria-hidden="true">
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
            <rect className="env" x="5" y="10" width="34" height="24" rx="5" stroke="currentColor" strokeWidth="2" />
            <path className="flap" d="M7 13l15 11 15-11" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1>Check your email</h1>
        <p className="auth-sub">
          We sent a sign-in link to <strong className="t-plain">{state.email}</strong>. It works once and expires in 10 minutes.
        </p>
        <p className="auth-hint">Nothing there? Check spam, or</p>
        <button type="button" className="link-btn" onClick={() => setState({ kind: "idle" })}>
          use a different email
        </button>
      </section>
    );
  }

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <Mark size={36} animated />
      <h1 id="auth-title">{cli ? "Sign in to connect this computer" : "Sign in to Postrun"}</h1>
      <p className="auth-sub">{cli ? "Then you can share sessions from the review app and postrun share." : "New here? Either way in creates your account."}</p>

      <button type="button" className="btn btn-ghost auth-github" onClick={() => void github()} disabled={busy}>
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        {busy && state.via === "github" ? "Opening GitHub…" : "Continue with GitHub"}
      </button>

      <div className="auth-or" role="separator">
        <span>or</span>
      </div>

      <form className="auth-form" onSubmit={(e) => void email(e)}>
        <label htmlFor="auth-email">Email</label>
        <input id="auth-email" name="email" type="email" required placeholder="you@company.com" autoComplete="email" disabled={busy} />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy && state.via === "email" ? (
            <>
              <span className="spin" aria-hidden="true"></span>Sending…
            </>
          ) : (
            "Email me a sign-in link"
          )}
        </button>
        <p className="auth-hint">No password to remember. The link signs you in.</p>
      </form>

      {state.kind === "error" && (
        <p className="auth-notice" role="alert">
          {state.message}
        </p>
      )}

      <div className="auth-install">
        <span className="muted small">Recording never needs an account:</span>
        <code>npm install -g postrun</code>
      </div>
    </section>
  );
}
