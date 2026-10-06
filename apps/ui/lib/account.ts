"use client";

/**
 * Connecting this computer to a Postrun account from the review app: the same
 * flow as `postrun login`. The background process listens on 127.0.0.1 while the
 * person approves the computer at app.postrun.app in a new tab.
 */

import type { AccountResponse, ApiError, ConnectResponse } from "@postrun/core/server/api";
import { api, apiFetch } from "./api";

export async function getAccount(): Promise<AccountResponse> {
  const r = await apiFetch(api.account());
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.json()) as AccountResponse;
}

/**
 * Call straight from a click: the tab is opened before anything is awaited, or the browser
 * blocks it. Resolves with the approval page's address; `onDone` gets the account once the
 * person has approved (or gives up after 10 minutes). Returns a function that stops waiting.
 */
export async function startConnect(onDone: (a: AccountResponse) => void): Promise<{ url: string; stop: () => void }> {
  const tab = window.open("about:blank", "_blank");
  try {
    const r = await apiFetch(api.connect(), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as ApiError).error ?? `${r.status}`);
    const { url } = (await r.json()) as ConnectResponse;
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      getAccount()
        .then((a) => {
          if (a.signed_in || !a.connecting || Date.now() - started > 10 * 60_000) {
            window.clearInterval(timer);
            onDone(a);
          }
        })
        .catch(() => undefined);
    }, 1500);
    return { url, stop: () => window.clearInterval(timer) };
  } catch (e) {
    tab?.close();
    throw e;
  }
}
