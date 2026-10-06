"use client";

/**
 * Settings > Account. Recording never needs an account; this is only for share
 * links. Connect runs the same flow as `postrun login`: the background process
 * waits on 127.0.0.1 while you approve this computer at app.postrun.app.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountResponse, ApiError, ConnectResponse } from "@postrun/core/server/api";
import { Loader } from "@postrun/brand/logo";
import { api, apiFetch, DEMO } from "@/lib/api";

type State = { kind: "loading" } | { kind: "demo" } | { kind: "ready"; a: AccountResponse } | { kind: "waiting"; a: AccountResponse; url: string } | { kind: "error"; a?: AccountResponse; message: string };

async function account(): Promise<AccountResponse> {
  const r = await apiFetch(api.account());
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.json()) as AccountResponse;
}

export function AccountCard() {
  const [s, setS] = useState<State>(DEMO ? { kind: "demo" } : { kind: "loading" });
  const [confirmOut, setConfirmOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const poll = useRef<number | undefined>(undefined);

  const load = useCallback(() => {
    account()
      .then((a) => setS({ kind: "ready", a }))
      .catch(() => setS({ kind: "error", message: "Couldn't check this computer's sign-in." }));
  }, []);
  useEffect(() => {
    if (!DEMO) load();
    return () => window.clearInterval(poll.current);
  }, [load]);

  async function connect(a: AccountResponse) {
    // Open the tab now, while this is still the click: browsers block tabs opened later.
    const tab = window.open("about:blank", "_blank");
    setBusy(true);
    try {
      const r = await apiFetch(api.connect(), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as ApiError).error ?? `${r.status}`);
      const { url } = (await r.json()) as ConnectResponse;
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      }
      setS({ kind: "waiting", a, url });
      const started = Date.now();
      window.clearInterval(poll.current);
      poll.current = window.setInterval(() => {
        account()
          .then((next) => {
            if (next.signed_in) {
              window.clearInterval(poll.current);
              setS({ kind: "ready", a: next });
            } else if (!next.connecting || Date.now() - started > 10 * 60_000) {
              window.clearInterval(poll.current);
              setS({ kind: "ready", a: next });
            }
          })
          .catch(() => undefined);
      }, 1500);
    } catch (e) {
      tab?.close();
      setS({ kind: "error", a, message: `Couldn't start signing in: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const r = await apiFetch(api.disconnect(), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      setS({ kind: "ready", a: (await r.json()) as AccountResponse });
    } catch {
      load();
    } finally {
      setBusy(false);
      setConfirmOut(false);
    }
  }

  const manage = (server: string) => `${server}/shares`;

  return (
    <section id="account" className="set-card" aria-labelledby="account-h">
      <h2 id="account-h">Account</h2>
      {s.kind === "loading" && (
        <div className="set-row">
          <Loader size={18} inline label="Checking" />
        </div>
      )}
      {s.kind === "demo" && (
        <div className="set-row">
          <div className="set-text">
            <div className="set-title">Share links</div>
            <div className="set-note">In your own Postrun, connect an account to send a session as a link instead of a file. Recording never needs one.</div>
          </div>
        </div>
      )}
      {(s.kind === "ready" || s.kind === "error") && s.a?.signed_in && (
        <div className="set-row">
          <div className="set-text">
            <div className="set-title">
              <span className="acct-dot" aria-hidden="true"></span>Signed in as {s.a.email ?? "your account"}
            </div>
            <div className="set-note">This computer can make share links. See how often each was opened, or turn them off, at {s.a.server.replace(/^https?:\/\//, "")}.</div>
          </div>
          <div className="set-control acct-actions">
            {confirmOut ? (
              <>
                <button type="button" className="btn ghost" onClick={() => setConfirmOut(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className="btn danger" onClick={() => void signOut()} disabled={busy}>
                  {busy ? <Loader size={15} inline label="Signing out" /> : "Sign out"}
                </button>
              </>
            ) : (
              <>
                <a className="btn" href={manage(s.a.server)} target="_blank" rel="noreferrer">
                  Your share links ↗
                </a>
                <button type="button" className="btn ghost" onClick={() => setConfirmOut(true)}>
                  Sign out
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {(s.kind === "ready" || s.kind === "error") && !s.a?.signed_in && (
        <div className="set-row">
          <div className="set-text">
            <div className="set-title">Not signed in</div>
            <div className="set-note">Recording and review never need an account. Connect one to send a session as a share link: the same redacted report, as a link that expires. Free, with GitHub or an email link.</div>
          </div>
          <div className="set-control">
            <button type="button" className="btn primary" onClick={() => void connect(s.a ?? { signed_in: false, server: "https://app.postrun.app" })} disabled={busy}>
              {busy ? <Loader size={15} inline label="Opening" /> : "Connect account"}
            </button>
          </div>
        </div>
      )}
      {s.kind === "waiting" && (
        <div className="set-row acct-waiting">
          <Loader size={22} inline label="Waiting for the browser" />
          <div className="set-text">
            <div className="set-title">Finish in your browser</div>
            <div className="set-note">
              Approve this computer on the page that just opened. Didn&apos;t open?{" "}
              <a href={s.url} target="_blank" rel="noreferrer">
                Open it here
              </a>
              .
            </div>
          </div>
        </div>
      )}
      {s.kind === "error" && (
        <p className="set-note acct-err" role="alert">
          {s.message}
        </p>
      )}
    </section>
  );
}
