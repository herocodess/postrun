/**
 * Where the UI reads its data. Normally the local core server's API; in the
 * public demo build (NEXT_PUBLIC_POSTRUN_DEMO=1, served at postrun.app/demo)
 * the same responses are static JSON files written by `pnpm demo:build`.
 */

export const DEMO = process.env["NEXT_PUBLIC_POSTRUN_DEMO"] === "1";
const BASE = process.env["NEXT_PUBLIC_BASE_PATH"] ?? "";
const enc = encodeURIComponent;

export const api = {
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
  exportDownload(id: string): string {
    return DEMO ? `${BASE}/data/exports/${enc(id)}.html` : `/api/sessions/${enc(id)}/export`;
  },
};
