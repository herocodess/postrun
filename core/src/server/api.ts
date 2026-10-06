/**
 * Wire types for the localhost API. Pure types: safe for the UI to import.
 *
 *   GET /api/sessions[?agent=<kind>]   -> SessionListResponse
 *   GET /api/sessions/:id              -> SessionDetailResponse | ApiError (404)
 *   GET /api/sessions/:id?since=<as_of> -> SessionDeltaResponse (only steps written after as_of)
 *   GET /api/sessions/:id/steps/:step  -> StepResponse (one step in full)
 *   POST /api/ingest  IngestRequest    -> IngestResponse (201 created, 200 updated)
 *                                         | IngestErrorResponse (400, 401, 409, 413, 415)
 *   GET /api/events[?session=<id>]     -> text/event-stream of LiveChange (see live.ts)
 *   GET /api/sessions/:id/export        -> redacted HTML report, as a download
 *   GET /api/sessions/:id/export/review -> ExportReviewResponse
 */

import type { SessionReport } from "../report/index.js";
import type { Actor, SessionSegment, Step, Turn, ValidationError } from "../schema/index.js";
export type { LiveChange } from "./live.js";
import type { RedactionReport } from "../redact/redact.js";
export type { RedactionReport, Finding, SecretKind } from "../redact/redact.js";
import type { IngestResult, SessionHeader, SessionSummary, StoredSession } from "../store/types.js";

export interface SessionListResponse {
  sessions: SessionSummary[];
  /** Agent kinds present in the store, for the filter control. */
  agents: string[];
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
 * after `since`. When steps were removed since then, `reload` is true and the
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
export type IngestResponse = Omit<IngestResult, "changed" | "written">;

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
