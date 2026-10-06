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
    return `/api/export?ids=${ids.map(enc).join(",")}`;
  },
  status(): string {
    return "/api/status";
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
    return "/api/backup";
  },
  deleteAll(): string {
    return "/api/data/delete";
  },
  exportDownload(id: string): string {
    return DEMO ? `${BASE}/data/exports/${enc(id)}.html` : `/api/sessions/${enc(id)}/export`;
  },
};
