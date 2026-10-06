/**
 * Wire types for the localhost API. Pure types: safe for the UI to import.
 *
 *   GET /api/sessions[?agent=&q=&from=&to=&min_steps=&failed=1&empty=0&limit=&cursor=]
 *                                      -> SessionListResponse | ApiError (400 bad filter)
 *   GET /api/sessions/:id              -> SessionDetailResponse | ApiError (404)
 *   GET /api/sessions/:id?since=<as_of> -> SessionDeltaResponse (only steps written after as_of)
 *   GET /api/sessions/:id/steps/:step  -> StepResponse (one step in full)
 *   DELETE /api/sessions/:id           -> DeleteSessionResponse | ApiError (403 cross-site, 404)
 *   POST /api/ingest  IngestRequest    -> IngestResponse (201 created, 200 updated)
 *                                         | IngestErrorResponse (400, 401, 409, 413, 415)
 *   GET /api/events[?session=<id>]     -> text/event-stream of LiveChange (see live.ts)
 *   GET /api/sessions/:id/export        -> redacted HTML report, as a download
 *   GET /api/sessions/:id/export/review -> ExportReviewResponse
 *   PUT /api/sessions/:id/verdict  VerdictRequest -> VerdictResponse (same origin only)
 *   GET /api/dashboard?days=1|7|30      -> Dashboard
 *   GET /api/projects                   -> ProjectsResponse
 *   GET /api/projects/files?root=       -> ProjectFilesResponse
 *   GET /api/export?ids=a,b             -> zip of redacted HTML reports, as a download
 *
 * With the background process (postrun start), also:
 *   GET /api/status                     -> AppStatus
 *   GET /api/doctor                     -> DoctorResponse
 *   PUT /api/settings  Partial<AppSettings> -> AppStatus (same origin only)
 *   POST /api/recording { paused }      -> AppStatus (same origin only)
 *   POST /api/setup                     -> SetupResponse (same origin only)
 *   GET /api/backup                     -> the whole store as one SQLite file, as a download
 *   POST /api/data/delete { confirm: "delete everything" } -> DeleteAllResponse (same origin only)
 * Without it (a plain dev server), those answer 501.
 */

import type { SessionReport } from "../report/index.js";
import type { Actor, SessionSegment, Step, Turn, ValidationError } from "../schema/index.js";
export type { LiveChange } from "./live.js";
import type { RedactionReport } from "../redact/redact.js";
export type { RedactionReport, Finding, SecretKind } from "../redact/redact.js";
import type { UsageSummary } from "../store/usage.js";
export type { UsageEvent, UsageSummary } from "../store/usage.js";

/** GET /api/usage: local feature counts, and the same summary as plain text (what postrun stats prints). */
export type UsageResponse = UsageSummary & { text: string };
import type { IngestResult, SessionHeader, SessionSummary, StoredSession } from "../store/types.js";
import type { ProjectSummary } from "../store/store.js";
export type { Dashboard, DashboardTotals, ProjectSummary } from "../store/store.js";

export interface SessionListResponse {
  sessions: SessionSummary[];
  /** Agent kinds present in the store, for the filter control. */
  agents: string[];
  /** Sessions matching the filters, across every page. */
  total: number;
  /** Reported cost of every matching session. */
  total_cost: number;
  /** Matching sessions with no steps, whether or not they are included. */
  empty_count: number;
  /** Present when there is another page: pass it as ?cursor= with the same filters. */
  next_cursor?: string;
  /** With a search of 3+ characters: where it matched inside a session's steps (\u0001 and \u0002 mark the match). */
  matches?: Record<string, { seq: number; text: string }>;
}

export interface VerdictRequest {
  /** "approved" shows as Looks good, "needs_attention" as Needs follow-up; null clears the review. */
  state: "approved" | "needs_attention" | null;
  note?: string;
}

export interface VerdictResponse {
  id: string;
  verdict: { state: string; note?: string } | null;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
}

export interface ProjectFilesResponse {
  root: string;
  files: Array<{ path: string; edits: number; reads: number; sessions: number }>;
}

/** Settings the review app can change. Stored in ~/.postrun/config.json. */
export interface AppSettings {
  /** Start Postrun when you log in (launchd or systemd). */
  autostart: boolean;
  /** Hours to keep a quiet session's raw logs; 0 keeps them. */
  raw_log_hours: number;
  /** A desktop notification when a running session fails several steps in a row. */
  notify_failures: boolean;
  /** Check npm once a day for a newer Postrun. The only network call Postrun makes, and only when on. */
  update_check: boolean;
}

export interface AppStatus {
  version: string;
  pid: number;
  recording: { paused: boolean; since: string; last_activity?: string; telemetry: string; catching_up: boolean };
  agents: {
    claude_code: { found: boolean; configured: boolean; mode: "telemetry" | "hooks only"; settings_path: string; last_activity?: string };
    cline: { found: boolean; dir: string };
  };
  storage: { home: string; total_bytes: number; store_bytes: number; raw_bytes: number; sessions: number };
  autostart: { supported: boolean; reason?: string };
  settings: AppSettings;
  update?: { current: string; latest: string; newer: boolean; checked_at: string };
  address: string;
}

export interface DoctorCheck {
  level: "ok" | "info" | "warn" | "fail";
  title: string;
  detail?: string;
  fix?: string;
}

export interface DoctorResponse {
  checks: DoctorCheck[];
}

export interface SetupResponse {
  summary: string;
}

export interface DeleteAllResponse {
  deleted: number;
}

/** What the background process provides to the server for the app's own routes. */
export interface AppControl {
  status(): Promise<AppStatus>;
  doctor(): Promise<DoctorCheck[]>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppStatus>;
  setPaused(paused: boolean): Promise<AppStatus>;
  runSetup(): Promise<SetupResponse>;
  deleteAll(): Promise<DeleteAllResponse>;
}

/**
 * A step as the session view first receives it: long output, messages and
 * diffs are cut to their first 2 KB, with each cut field's full length in
 * `truncated`. GET /api/sessions/:id/steps/:step returns it in full.
 */
export type StepPreview = Step & { truncated?: Record<string, number> };

export interface SessionDetailResponse extends Omit<StoredSession, "steps"> {
  steps: StepPreview[];
  report: SessionReport;
  /** Pass back as ?since= to get only what changed after this response. */
  as_of: string;
}

/**
 * The answer to ?since=: everything small in full, and only the steps written
 * after `since`. Turns come without step_ids (group steps by turn_id instead). When steps were removed since then, `reload` is true and the
 * caller should fetch the whole session again instead of applying this.
 */
export interface SessionDeltaResponse extends Omit<SessionDetailResponse, "steps"> {
  delta: true;
  reload: boolean;
  steps: StepPreview[];
}

export interface StepResponse {
  step: Step;
}

export interface DeleteSessionResponse {
  deleted: true;
  id: string;
  agent_kind: string;
  /** Whether Postrun's raw capture files for the session were found and removed. */
  removed_capture_files: boolean;
}

export interface ApiError {
  error: string;
}

/**
 * One push to POST /api/ingest. Send with `Authorization: Bearer <token>`
 * (token in ~/.postrun/ingest-token) and `Content-Type: application/json`,
 * optionally gzip-encoded. At most 8 MB and 5000 items of each kind per push.
 *
 * Batches are incremental: children are upserted by id (segments by index),
 * nothing is deleted, and a child may point at records sent in earlier
 * batches. Send parents before or with their children: a step's turn, actor,
 * and segment must already exist or be in the same batch. Turn.step_ids is
 * accepted but ignored; the store projects it from the steps.
 */
export interface IngestRequest {
  schema_version: "1.2";
  session: SessionHeader;
  segments?: SessionSegment[];
  actors?: Actor[];
  turns?: Turn[];
  steps?: Step[];
}

/** Counts are for this batch, not the session total. The store's internal change counters are not part of it. */
export type IngestResponse = Omit<IngestResult, "changed" | "written" | "missing_content">;

export interface IngestErrorResponse {
  error: string;
  /** Per-field problems, each with a path into the request body, e.g. "steps[3].payload.exit_code". */
  details?: ValidationError[];
  /** How many further problems were found beyond those listed. */
  omitted?: number;
}

/** What an export would contain and mask, so the UI can show it before download. */
export interface ExportReviewResponse {
  filename: string;
  bytes: number;
  redaction: RedactionReport;
}
