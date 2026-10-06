"use client";

import { track } from "@vercel/analytics";
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
      // Production builds refuse to ship without NEXT_PUBLIC_WAITLIST_URL (scripts/prod-check.mjs).
      setState({ kind: "error", message: "Sign-ups aren't open yet. Check back soon." });
      return;
    }
    setState({ kind: "sending" });
    try {
      const res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email }) });
      if (!res.ok) throw new Error(String(res.status));
      setState({ kind: "done" });
      track("Waitlist signup"); // the event only: the email is never sent to analytics
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
