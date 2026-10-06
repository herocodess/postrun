"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Mark } from "@/components/Logo";

type Mode = "login" | "signup";
type State = { kind: "idle" } | { kind: "pending"; via: "github" | "email" } | { kind: "notice"; message: string };

/**
 * The sign-in form. Accounts are not switched on yet, so both ways in end in
 * an honest notice instead of pretending to sign anyone in. The real flow
 * (GitHub OAuth and an email link) plugs in at `start()`.
 */
export function LoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [state, setState] = useState<State>({ kind: "idle" });

  // ?mode=signup opens the sign-up view. Read after mount: the page is a static export.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "signup") setMode("signup");
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setState({ kind: "idle" });
    const url = new URL(window.location.href);
    if (next === "signup") url.searchParams.set("mode", "signup");
    else url.searchParams.delete("mode");
    window.history.replaceState(null, "", url);
  };

  function start(via: "github" | "email") {
    setState({ kind: "pending", via });
    window.setTimeout(
      () =>
        setState({
          kind: "notice",
          message: "Accounts aren't open yet. You don't need one to record and review: install Postrun and run postrun setup.",
        }),
      600,
    );
  }

  function onEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    start("email");
  }

  const signup = mode === "signup";
  const busy = state.kind === "pending";

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <Mark size={36} />
      <h1 id="auth-title">{signup ? "Create your Postrun account" : "Log in to Postrun"}</h1>
      <p className="auth-sub">{signup ? "Share sessions on purpose, and see what your team chose to share." : "Welcome back. Pick up where your agents left off."}</p>

      <button type="button" className="btn btn-ghost auth-github" onClick={() => start("github")} disabled={busy} data-track={signup ? "Sign up: GitHub" : "Log in: GitHub"}>
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        {busy && state.via === "github" ? "Connecting…" : "Continue with GitHub"}
      </button>

      <div className="auth-or" role="separator">
        <span>or</span>
      </div>

      <form className="auth-form" onSubmit={onEmail}>
        <label htmlFor="auth-email">Email</label>
        <input id="auth-email" name="email" type="email" required placeholder="you@company.com" autoComplete="email" disabled={busy} />
        <button type="submit" className="btn btn-primary" disabled={busy} data-track={signup ? "Sign up: email" : "Log in: email"}>
          {busy && state.via === "email" ? "Sending…" : signup ? "Create account" : "Continue with email"}
        </button>
        <p className="auth-hint">{signup ? "We'll email you a link to finish creating your account." : "We'll email you a link to log in. No password to remember."}</p>
      </form>

      {state.kind === "notice" && (
        <p className="auth-notice" role="status">
          {state.message}
        </p>
      )}

      <p className="auth-switch">
        {signup ? "Already have an account?" : "New to Postrun?"}{" "}
        <button type="button" className="link-btn" onClick={() => switchMode(signup ? "login" : "signup")}>
          {signup ? "Log in" : "Create an account"}
        </button>
      </p>

      <div className="auth-install">
        <span className="muted small">Recording doesn't need an account:</span>
        <code>npm install -g postrun</code>
      </div>
    </section>
  );
}
