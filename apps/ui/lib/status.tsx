"use client";

/**
 * The background process's status (recording, agents, storage, settings),
 * shared by the sidebar, the dashboard and Settings. Refreshed every 15
 * seconds and whenever something is recorded. A plain dev server has no
 * status (501): `available` is false and the pages say so. The demo shows a
 * fixed example.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AppStatus } from "@postrun/core/server/api";
import { api, DEMO } from "@/lib/api";
import { useLiveVersion } from "@/lib/live";

type StatusState = { kind: "loading" } | { kind: "ready"; status: AppStatus } | { kind: "unavailable" } | { kind: "offline" };

const DEMO_STATUS: AppStatus = {
  version: "0.2.0",
  pid: 0,
  address: "http://127.0.0.1:1234/",
  recording: { paused: false, since: new Date().toISOString(), telemetry: "running", catching_up: false },
  agents: {
    claude_code: { found: true, configured: true, mode: "telemetry", settings_path: "~/.claude/settings.json" },
    cline: { found: true, dir: "~/.cline/data/sessions" },
  },
  storage: { home: "~/.postrun", total_bytes: 3_400_000, store_bytes: 3_100_000, raw_bytes: 300_000, sessions: 3 },
  autostart: { supported: true },
  settings: { autostart: true, raw_log_hours: 24, notify_failures: false, update_check: false },
};

const Ctx = createContext<{ state: StatusState; refresh: () => void; set: (s: AppStatus) => void }>({
  state: { kind: "loading" },
  refresh: () => undefined,
  set: () => undefined,
});

export function StatusProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StatusState>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  const live = useLiveVersion();
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const set = useCallback((status: AppStatus) => setState({ kind: "ready", status }), []);

  useEffect(() => {
    // The demo's status is fixed, but it is set after the first paint so times match the visitor's clock and zone.
    if (DEMO) {
      setState((prev) => (prev.kind === "ready" ? prev : { kind: "ready", status: { ...DEMO_STATUS, recording: { ...DEMO_STATUS.recording, since: new Date().toISOString() } } }));
      return;
    }
    let cancelled = false;
    fetch(api.status())
      .then(async (res) => {
        if (res.status === 501) return { kind: "unavailable" } as const;
        if (!res.ok) throw new Error(String(res.status));
        return { kind: "ready", status: (await res.json()) as AppStatus } as const;
      })
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState((prev) => (prev.kind === "ready" ? prev : { kind: "offline" })));
    return () => {
      cancelled = true;
    };
  }, [tick, live]);

  useEffect(() => {
    // The demo's status is fixed, but it is set after the first paint so times match the visitor's clock and zone.
    if (DEMO) {
      setState((prev) => (prev.kind === "ready" ? prev : { kind: "ready", status: { ...DEMO_STATUS, recording: { ...DEMO_STATUS.recording, since: new Date().toISOString() } } }));
      return;
    }
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  return <Ctx.Provider value={{ state, refresh, set }}>{children}</Ctx.Provider>;
}

export function useStatus() {
  return useContext(Ctx);
}

/** "2 minutes ago" style, for activity times. */
export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "no activity yet";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

export function megabytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
