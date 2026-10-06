"use client";

/**
 * Counting the uses only the page can see (opening the app, copying a PR summary, …) in the local
 * store. Nothing leaves this computer: the counts live in ~/.postrun next to the sessions, and are
 * shown in Settings and by `postrun stats`. Fire and forget: counting never gets in the way.
 */

import { apiFetch, DEMO } from "@/lib/api";

export type ClientUsageEvent = "app_opened" | "session_viewed" | "pr_summary_copied" | "changes_viewed" | "keyboard_used";

const once = new Set<string>();

/** Count one use. With `key`, only once per page load for that key (one keyboard use per session viewed, say). */
export function track(event: ClientUsageEvent, key?: string): void {
  if (DEMO || typeof window === "undefined") return;
  if (key !== undefined) {
    const k = `${event}:${key}`;
    if (once.has(k)) return;
    once.add(k);
  }
  void apiFetch("/api/usage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event }) }).catch(() => undefined);
}
