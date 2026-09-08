/**
 * Wire types for the localhost API. Pure types: safe for the UI to import.
 *
 *   GET /api/sessions[?agent=<kind>]   -> SessionListResponse
 *   GET /api/sessions/:id              -> SessionDetailResponse | ApiError (404)
 */

import type { SessionReport } from "../report/index.js";
import type { SessionSummary, StoredSession } from "../store/types.js";

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
