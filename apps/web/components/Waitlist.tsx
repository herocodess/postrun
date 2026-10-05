"use client";

import { useState, type FormEvent } from "react";

/**
 * Early-access form. Posts the email to NEXT_PUBLIC_WAITLIST_URL (any endpoint
 * that accepts a form POST with an `email` field: Formspree, Tally, a Worker).
 * Until that is set, it says so instead of pretending to sign anyone up.
 */
const ENDPOINT = process.env["NEXT_PUBLIC_WAITLIST_URL"] ?? "";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "done" } | { kind: "error"; message: string };

export function Waitlist() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    if (!ENDPOINT) {
      setState({ kind: "error", message: "The waitlist isn't connected yet. Set NEXT_PUBLIC_WAITLIST_URL to turn it on." });
      return;
    }
    setState({ kind: "sending" });
    try {
      const res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email }) });
      if (!res.ok) throw new Error(String(res.status));
      setState({ kind: "done" });
    } catch {
      setState({ kind: "error", message: "That didn't go through. Try again in a moment." });
    }
  }

  if (state.kind === "done") {
    return (
      <p className="wl-done" role="status">
        You're on the list. We'll email you when your agent is supported.
      </p>
    );
  }

  return (
    <form className="wl-form" onSubmit={submit}>
      <label htmlFor="wl-email" className="sr-only">
        Work email
      </label>
      <input id="wl-email" name="email" type="email" required placeholder="you@company.com" autoComplete="email" />
      <button type="submit" className="btn btn-primary" disabled={state.kind === "sending"}>
        {state.kind === "sending" ? "Sending…" : "Get early access"}
      </button>
      {state.kind === "error" && (
        <p className="wl-error" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
