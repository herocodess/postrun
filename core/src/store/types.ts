import type { Actor, AgentInfo, SessionSegment, Step, TokenUsage, Turn, Verdict, Workspace } from "../schema/index.js";

/**
 * A normalized session ready for ingest. Produced from either adapter's output.
 * Everything here is captured data; totals derived from steps are NOT included,
 * they are projected on read by the store.
 */
export interface SessionRecord {
  id: string;
  agent: AgentInfo;
  workspace: Workspace;
  started_at: string;
  ended_at?: string;
  segments: SessionSegment[];
  actors: Actor[];
  turns: Turn[];
  steps: Step[];
  /**
   * Adapter-reported API metrics. Stored as captured, not projected, because
   * api_request events are session-level telemetry and are not steps (v1.2
   * finding 11), so cost cannot be rebuilt from the step stream.
   */
  metrics: SessionMetrics;
  /** Where this session was ingested from (captures dir, session file), for provenance. */
  source: string;
  verdict?: Verdict;
}

export interface SessionMetrics {
  cost_usd: number;
  api_requests: number;
  tokens: TokenUsage;
}

/** One row of the history list. Counts and title are projected on read. */
export interface SessionSummary {
  id: string;
  agent: AgentInfo;
  workspace: Workspace;
  owner_id: string;
  captured_on: string;
  source: string;
  title?: string; // first user prompt, projected
  started_at: string;
  ended_at?: string;
  ingested_at: string;
  updated_at: string;
  steps_total: number;
  step_counts: Record<string, number>;
  failed_count: number;
  reference_only_count: number;
  flag_count: number;
  turn_count: number;
  metrics: SessionMetrics;
  verdict?: Verdict;
}

/** A full session as loaded from the store. */
export interface StoredSession {
  summary: SessionSummary;
  segments: SessionSegment[];
  actors: Actor[];
  turns: Turn[]; // step_ids projected from steps by turn_id in seq order
  steps: Step[];
}

export interface IngestResult {
  session_id: string;
  created: boolean; // false when the session row already existed (update)
  steps: number;
  turns: number;
  segments: number;
  actors: number;
}

export interface StoreCounts {
  sessions: number;
  segments: number;
  actors: number;
  turns: number;
  steps: number;
}
