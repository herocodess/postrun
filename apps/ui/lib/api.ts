/**
 * Where the UI reads its data. Normally the local core server's API; in the
 * public demo build (NEXT_PUBLIC_POSTRUN_DEMO=1, served at postrun.app/demo)
 * the same responses are static JSON files written by `pnpm demo:build`.
 */

export const DEMO = process.env["NEXT_PUBLIC_POSTRUN_DEMO"] === "1";
const BASE = process.env["NEXT_PUBLIC_BASE_PATH"] ?? "";
const enc = encodeURIComponent;

// ---- the key ----------------------------------------------------------------------------------
// The local API answers only requests that carry this computer's key, so another account on a
// shared computer cannot read your sessions. `postrun open` opens the app at /#key=<key>: the
// fragment never reaches a server. It is kept in this browser (per origin, so per port) and
// removed from the address bar before anything renders.

const KEY_STORE = "postrun.key";
export const LOCKED_EVENT = "postrun:locked";
let key: string | null = null;

if (typeof window !== "undefined" && !DEMO) {
  try {
    const m = /(?:^#|&)key=([A-Za-z0-9_-]{32,})/.exec(window.location.hash);
    if (m) {
      key = m[1] as string;
      window.localStorage.setItem(KEY_STORE, key);
      scrubKeyFromAddress();
    } else {
      key = window.localStorage.getItem(KEY_STORE);
    }
  } catch {
    // storage blocked: requests go without a key and the app asks to be connected
  }
}

/**
 * Remove #key=… from the address bar (and so from history and screenshots). Keeps the router's
 * history state; the app calls it again after the router has started, since the router restores
 * the address it started with.
 */
export function scrubKeyFromAddress(): void {
  if (typeof window === "undefined" || !/(?:^#|&)key=/.test(window.location.hash)) return;
  const rest = window.location.hash.replace(/(?:^#|&)key=[A-Za-z0-9_-]+/, "").replace(/^&/, "#");
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + (rest === "#" ? "" : rest));
}

export function hasKey(): boolean {
  return DEMO || key !== null;
}

/** fetch for the local API: adds the key, and tells the app when this browser is not connected. */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (DEMO || !url.startsWith("/api/")) return fetch(url, init);
  const headers = new Headers(init.headers);
  if (key) headers.set("authorization", `Bearer ${key}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event(LOCKED_EVENT));
  return res;
}

/** For links and streams that cannot send a header (downloads, EventSource): the key as ?key=. */
export function withKey(url: string): string {
  if (DEMO || !key || !url.startsWith("/api/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}key=${enc(key)}`;
}

export const api = {
  /** The live stream. EventSource cannot send headers, so the key rides in the query. */
  events(): string {
    return withKey("/api/events");
  },
  /** Session list (lib/sessions.ts adds the filters). The demo serves every session from one file. */
  sessionsBase(): string {
    return DEMO ? `${BASE}/data/sessions.json` : "/api/sessions";
  },
  session(id: string): string {
    return DEMO ? `${BASE}/data/sessions/${enc(id)}.json` : `/api/sessions/${enc(id)}`;
  },
  /** Only the steps written after `asOf` (a previous response's as_of). The demo never changes, so it is never asked. */
  sessionSince(id: string, asOf: string): string {
    return `/api/sessions/${enc(id)}?since=${enc(asOf)}`;
  },
  /** DELETE removes a session. Never offered in the demo. */
  deleteSession(id: string): string {
    return `/api/sessions/${enc(id)}`;
  },
  /** One step in full, for a step whose preview was cut. Demo data is never cut. */
  step(sessionId: string, stepId: string): string {
    return `/api/sessions/${enc(sessionId)}/steps/${enc(stepId)}`;
  },
  exportReview(id: string): string {
    return DEMO ? `${BASE}/data/exports/${enc(id)}.review.json` : `/api/sessions/${enc(id)}/export/review`;
  },
  /** PUT { state, note } to review a session. Never offered in the demo. */
  verdict(id: string): string {
    return `/api/sessions/${enc(id)}/verdict`;
  },
  /** The demo has one snapshot per period, written by demo:build. */
  dashboard(days: number): string {
    return DEMO ? `${BASE}/data/dashboard-${days}.json` : `/api/dashboard?days=${days}`;
  },
  projects(): string {
    return DEMO ? `${BASE}/data/projects.json` : "/api/projects";
  },
  projectFiles(root: string): string {
    return DEMO ? `${BASE}/data/project-files/${enc(root.replace(/[^A-Za-z0-9._-]+/g, "_"))}.json` : `/api/projects/files?root=${enc(root)}`;
  },
  /** Several sessions as one zip of redacted reports. Not in the demo. */
  exportMany(ids: string[]): string {
    return withKey(`/api/export?ids=${ids.map(enc).join(",")}`);
  },
  status(): string {
    return "/api/status";
  },
  /** Local usage counts. The demo has a fixed example. */
  usage(): string {
    return DEMO ? `${BASE}/data/usage.json` : "/api/usage";
  },
  doctor(): string {
    return "/api/doctor";
  },
  settings(): string {
    return "/api/settings";
  },
  recording(): string {
    return "/api/recording";
  },
  setup(): string {
    return "/api/setup";
  },
  backup(): string {
    return withKey("/api/backup");
  },
  deleteAll(): string {
    return "/api/data/delete";
  },
  exportDownload(id: string): string {
    return DEMO ? `${BASE}/data/exports/${enc(id)}.html` : withKey(`/api/sessions/${enc(id)}/export`);
  },
};
