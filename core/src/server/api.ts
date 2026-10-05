/**
 * Wire types for the localhost API. Pure types: safe for the UI to import.
 *
 *   GET /api/sessions[?agent=<kind>]   -> SessionListResponse
 *   GET /api/sessions/:id              -> SessionDetailResponse | ApiError (404)
 *   POST /api/ingest  IngestRequest    -> IngestResponse (201 created, 200 updated)
 *                                         | IngestErrorResponse (400, 401, 409, 413, 415)
 *   GET /api/events[?session=<id>]     -> text/event-stream of LiveChange (see live.ts)
 */

import type { SessionReport } from "../report/index.js";
import type { Actor, SessionSegment, Step, Turn, ValidationError } from "../schema/index.js";
export type { LiveChange } from "./live.js";
import type { IngestResult, SessionHeader, SessionSummary, StoredSession } from "../store/types.js";

export interface SessionListResponse {
  sessions: SessionSummary[];
  /** Agent kinds present in the store, for the filter control. */
  agents: string[];
}

export interface SessionDetailResponse extends StoredSession {
  report: SessionReport;
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

/** Counts are for this batch, not the session total. */
export type IngestResponse = IngestResult;

export interface IngestErrorResponse {
  error: string;
  /** Per-field problems, each with a path into the request body, e.g. "steps[3].payload.exit_code". */
  details?: ValidationError[];
  /** How many further problems were found beyond those listed. */
  omitted?: number;
}
