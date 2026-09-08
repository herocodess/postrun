/**
 * Local SQLite store for normalized sessions (better-sqlite3).
 *
 * - Tables follow the v1.2 shape: sessions, segments, actors, turns, steps.
 * - Steps are append-only from the store's point of view: ingest upserts by
 *   (session_id, id) and never deletes. Re-ingesting the same session is
 *   idempotent.
 * - Payloads, channels, and flags are stored as JSON text, faithfully.
 * - Projections (step counts, failed/reference-only/flag counts, title,
 *   turn step_ids) are computed on read, never stored. The one stored total is
 *   the adapter-reported API metrics, because cost events are not steps.
 * - Ownership seam: every session carries owner_id and captured_on. Local MVP
 *   fills a single local owner and this host. No users, auth, or sharing.
 *
 * Default file: ~/.postrun/postrun.db (override with the path option or POSTRUN_DB).
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import type { Actor, AgentInfo, SessionSegment, Step, Turn, Verdict, Workspace } from "../schema/index.js";
import type { IngestResult, SessionMetrics, SessionRecord, SessionSummary, StoreCounts, StoredSession } from "./types.js";

export const LOCAL_OWNER_ID = "local";
export const SCHEMA_VERSION = 1;

export interface StoreOptions {
  /** SQLite file path. ":memory:" for tests. Default ~/.postrun/postrun.db or POSTRUN_DB. */
  path?: string;
  ownerId?: string;
  capturedOn?: string;
}

export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env["POSTRUN_DB"] ?? join(homedir(), ".postrun", "postrun.db");
}

const DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL,
  captured_on          TEXT NOT NULL,
  agent_kind           TEXT NOT NULL,
  agent_version        TEXT NOT NULL,
  agent_format_version TEXT,
  workspace_root       TEXT NOT NULL,
  workspace_repo       TEXT,
  started_at           TEXT NOT NULL,
  ended_at             TEXT,
  source               TEXT NOT NULL,
  cost_usd             REAL NOT NULL DEFAULT 0,
  api_requests         INTEGER NOT NULL DEFAULT 0,
  tokens_input         INTEGER NOT NULL DEFAULT 0,
  tokens_output        INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read    INTEGER NOT NULL DEFAULT 0,
  tokens_cache_creation INTEGER NOT NULL DEFAULT 0,
  verdict_state        TEXT,
  verdict_note         TEXT,
  verdict_reviewer     TEXT,
  ingested_at          TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner_id);

CREATE TABLE IF NOT EXISTS segments (
  session_id   TEXT NOT NULL REFERENCES sessions(id),
  idx          INTEGER NOT NULL,
  start_reason TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  source_files TEXT NOT NULL,
  PRIMARY KEY (session_id, idx)
);

CREATE TABLE IF NOT EXISTS actors (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  id         TEXT NOT NULL,
  parent_id  TEXT,
  type       TEXT NOT NULL,
  label      TEXT,
  PRIMARY KEY (session_id, id)
);

CREATE TABLE IF NOT EXISTS turns (
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  id            TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  actor_id      TEXT NOT NULL,
  idx           INTEGER NOT NULL,
  prompt_id     TEXT,
  mode          TEXT,
  started_at    TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
);

CREATE TABLE IF NOT EXISTS steps (
  session_id     TEXT NOT NULL REFERENCES sessions(id),
  id             TEXT NOT NULL,
  segment_index  INTEGER NOT NULL,
  turn_id        TEXT NOT NULL,
  actor_id       TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  at             TEXT NOT NULL,
  type           TEXT NOT NULL,
  decision       TEXT NOT NULL,
  outcome        TEXT NOT NULL,
  content_status TEXT NOT NULL,
  error_type     TEXT,
  error_message  TEXT,
  channels       TEXT NOT NULL,
  payload        TEXT NOT NULL,
  flags          TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
);
CREATE INDEX IF NOT EXISTS steps_session_seq ON steps(session_id, seq);
CREATE INDEX IF NOT EXISTS steps_session_turn ON steps(session_id, turn_id, seq);
`;

interface SessionRow {
  id: string;
  owner_id: string;
  captured_on: string;
  agent_kind: string;
  agent_version: string;
  agent_format_version: string | null;
  workspace_root: string;
  workspace_repo: string | null;
  started_at: string;
  ended_at: string | null;
  source: string;
  cost_usd: number;
  api_requests: number;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_creation: number;
  verdict_state: string | null;
  verdict_note: string | null;
  verdict_reviewer: string | null;
  ingested_at: string;
  updated_at: string;
  // projected
  title: string | null;
  steps_total: number;
  failed_count: number;
  reference_only_count: number;
  flag_count: number;
  turn_count: number;
}

interface StepRow {
  id: string;
  session_id: string;
  segment_index: number;
  turn_id: string;
  actor_id: string;
  seq: number;
  at: string;
  type: string;
  decision: string;
  outcome: string;
  content_status: string;
  error_type: string | null;
  error_message: string | null;
  channels: string;
  payload: string;
  flags: string;
}

const SESSION_SELECT = `
SELECT s.*,
  (SELECT json_extract(st.payload, '$.text') FROM steps st
     WHERE st.session_id = s.id AND st.type = 'message' AND json_extract(st.payload, '$.role') = 'user'
       AND json_extract(st.payload, '$.text') IS NOT NULL
     ORDER BY st.seq LIMIT 1) AS title,
  (SELECT count(*) FROM steps st WHERE st.session_id = s.id) AS steps_total,
  (SELECT count(*) FROM steps st WHERE st.session_id = s.id AND st.outcome = 'failed') AS failed_count,
  (SELECT count(*) FROM steps st WHERE st.session_id = s.id AND st.content_status = 'reference_only') AS reference_only_count,
  (SELECT coalesce(sum(json_array_length(st.flags)), 0) FROM steps st WHERE st.session_id = s.id) AS flag_count,
  (SELECT count(*) FROM turns t WHERE t.session_id = s.id) AS turn_count
FROM sessions s`;

export class PostrunStore {
  readonly path: string;
  readonly ownerId: string;
  readonly capturedOn: string;
  private readonly db: Database.Database;

  constructor(opts: StoreOptions = {}) {
    this.path = opts.path ?? defaultDbPath();
    this.ownerId = opts.ownerId ?? LOCAL_OWNER_ID;
    this.capturedOn = opts.capturedOn ?? hostname();
    if (this.path !== ":memory:") mkdirSync(dirname(this.path), { recursive: true });
    this.db = new Database(this.path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000"); // capture (writer) and serve (reader) share the file
    this.migrate();
  }

  private migrate(): void {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > SCHEMA_VERSION) throw new Error(`${this.path} has schema version ${version}, newer than this build (${SCHEMA_VERSION})`);
    this.db.exec(DDL);
    if (version < SCHEMA_VERSION) this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  close(): void {
    this.db.close();
  }

  // ---- ingest ---------------------------------------------------------------

  ingest(record: SessionRecord): IngestResult {
    const now = new Date().toISOString();
    const run = this.db.transaction((r: SessionRecord): IngestResult => {
      const existing = this.db.prepare("SELECT ingested_at FROM sessions WHERE id = ?").get(r.id) as { ingested_at: string } | undefined;
      this.db
        .prepare(
          `INSERT INTO sessions (id, owner_id, captured_on, agent_kind, agent_version, agent_format_version, workspace_root, workspace_repo,
             started_at, ended_at, source, cost_usd, api_requests, tokens_input, tokens_output, tokens_cache_read, tokens_cache_creation,
             verdict_state, verdict_note, verdict_reviewer, ingested_at, updated_at)
           VALUES (@id, @owner_id, @captured_on, @agent_kind, @agent_version, @agent_format_version, @workspace_root, @workspace_repo,
             @started_at, @ended_at, @source, @cost_usd, @api_requests, @tokens_input, @tokens_output, @tokens_cache_read, @tokens_cache_creation,
             @verdict_state, @verdict_note, @verdict_reviewer, @ingested_at, @updated_at)
           ON CONFLICT(id) DO UPDATE SET
             agent_kind = excluded.agent_kind, agent_version = excluded.agent_version, agent_format_version = excluded.agent_format_version,
             workspace_root = excluded.workspace_root, workspace_repo = excluded.workspace_repo,
             started_at = excluded.started_at, ended_at = excluded.ended_at, source = excluded.source,
             cost_usd = excluded.cost_usd, api_requests = excluded.api_requests, tokens_input = excluded.tokens_input,
             tokens_output = excluded.tokens_output, tokens_cache_read = excluded.tokens_cache_read, tokens_cache_creation = excluded.tokens_cache_creation,
             verdict_state = coalesce(excluded.verdict_state, sessions.verdict_state),
             verdict_note = coalesce(excluded.verdict_note, sessions.verdict_note),
             verdict_reviewer = coalesce(excluded.verdict_reviewer, sessions.verdict_reviewer),
             updated_at = excluded.updated_at`,
        )
        .run({
          id: r.id,
          owner_id: this.ownerId,
          captured_on: this.capturedOn,
          agent_kind: r.agent.kind,
          agent_version: r.agent.version,
          agent_format_version: r.agent.format_version ?? null,
          workspace_root: r.workspace.root,
          workspace_repo: r.workspace.repo ?? null,
          started_at: r.started_at,
          ended_at: r.ended_at ?? null,
          source: r.source,
          cost_usd: r.metrics.cost_usd,
          api_requests: r.metrics.api_requests,
          tokens_input: r.metrics.tokens.input,
          tokens_output: r.metrics.tokens.output,
          tokens_cache_read: r.metrics.tokens.cache_read,
          tokens_cache_creation: r.metrics.tokens.cache_creation,
          verdict_state: r.verdict?.state ?? null,
          verdict_note: r.verdict?.note ?? null,
          verdict_reviewer: r.verdict?.reviewer ?? null,
          ingested_at: existing?.ingested_at ?? now,
          updated_at: now,
        });

      const seg = this.db.prepare(
        `INSERT INTO segments (session_id, idx, start_reason, started_at, ended_at, source_files)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, idx) DO UPDATE SET start_reason = excluded.start_reason, started_at = excluded.started_at,
           ended_at = excluded.ended_at, source_files = excluded.source_files`,
      );
      for (const g of r.segments) seg.run(r.id, g.index, g.start_reason, g.started_at, g.ended_at ?? null, JSON.stringify(g.source_files));

      const act = this.db.prepare(
        `INSERT INTO actors (session_id, id, parent_id, type, label) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id, id) DO UPDATE SET parent_id = excluded.parent_id, type = excluded.type, label = excluded.label`,
      );
      for (const a of r.actors) act.run(r.id, a.id, a.parent_id ?? null, a.type, a.label ?? null);

      const turn = this.db.prepare(
        `INSERT INTO turns (session_id, id, segment_index, actor_id, idx, prompt_id, mode, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, id) DO UPDATE SET segment_index = excluded.segment_index, actor_id = excluded.actor_id, idx = excluded.idx,
           prompt_id = excluded.prompt_id, mode = excluded.mode, started_at = excluded.started_at`,
      );
      for (const t of r.turns) turn.run(r.id, t.id, t.segment_index, t.actor_id, t.index, t.prompt_id ?? null, t.mode ?? null, t.started_at);

      const step = this.db.prepare(
        `INSERT INTO steps (session_id, id, segment_index, turn_id, actor_id, seq, at, type, decision, outcome, content_status,
           error_type, error_message, channels, payload, flags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, id) DO UPDATE SET segment_index = excluded.segment_index, turn_id = excluded.turn_id,
           actor_id = excluded.actor_id, seq = excluded.seq, at = excluded.at, type = excluded.type, decision = excluded.decision,
           outcome = excluded.outcome, content_status = excluded.content_status, error_type = excluded.error_type,
           error_message = excluded.error_message, channels = excluded.channels, payload = excluded.payload, flags = excluded.flags`,
      );
      for (const s of r.steps) {
        step.run(
          r.id, s.id, s.segment_index, s.turn_id, s.actor_id, s.seq, s.at, s.type, s.decision, s.outcome, s.content_status,
          s.error?.type ?? null, s.error?.message ?? null, JSON.stringify(s.channels), JSON.stringify(s.payload), JSON.stringify(s.flags),
        );
      }

      return { session_id: r.id, created: !existing, steps: r.steps.length, turns: r.turns.length, segments: r.segments.length, actors: r.actors.length };
    });
    return run(record);
  }

  // ---- query ----------------------------------------------------------------

  listSessions(filter: { agent?: string; owner_id?: string } = {}): SessionSummary[] {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (filter.agent) {
      where.push("s.agent_kind = @agent");
      params["agent"] = filter.agent;
    }
    if (filter.owner_id) {
      where.push("s.owner_id = @owner_id");
      params["owner_id"] = filter.owner_id;
    }
    const sql = `${SESSION_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY s.started_at DESC, s.id`;
    const rows = this.db.prepare(sql).all(params) as SessionRow[];
    return rows.map((row) => this.toSummary(row));
  }

  getSession(id: string): StoredSession | undefined {
    const row = this.db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id) as SessionRow | undefined;
    if (!row) return undefined;
    const summary = this.toSummary(row);
    const segments = (this.db.prepare("SELECT * FROM segments WHERE session_id = ? ORDER BY idx").all(id) as Array<{
      idx: number;
      start_reason: string;
      started_at: string;
      ended_at: string | null;
      source_files: string;
    }>).map((g) => {
      const seg: SessionSegment = { index: g.idx, start_reason: g.start_reason, started_at: g.started_at, source_files: JSON.parse(g.source_files) as string[] };
      if (g.ended_at !== null) seg.ended_at = g.ended_at;
      return seg;
    });
    const actors = (this.db.prepare("SELECT * FROM actors WHERE session_id = ? ORDER BY rowid").all(id) as Array<{
      id: string;
      parent_id: string | null;
      type: string;
      label: string | null;
    }>).map((a) => {
      const actor: Actor = { id: a.id, type: a.type };
      if (a.parent_id !== null) actor.parent_id = a.parent_id;
      if (a.label !== null) actor.label = a.label;
      return actor;
    });
    const steps = (this.db.prepare("SELECT * FROM steps WHERE session_id = ? ORDER BY seq").all(id) as StepRow[]).map(rowToStep);
    const stepIdsByTurn = new Map<string, string[]>();
    for (const s of steps) {
      const list = stepIdsByTurn.get(s.turn_id) ?? [];
      list.push(s.id);
      stepIdsByTurn.set(s.turn_id, list);
    }
    const turns = (this.db.prepare("SELECT * FROM turns WHERE session_id = ? ORDER BY idx").all(id) as Array<{
      id: string;
      segment_index: number;
      actor_id: string;
      idx: number;
      prompt_id: string | null;
      mode: string | null;
      started_at: string;
    }>).map((t) => {
      const turn: Turn = {
        id: t.id,
        session_id: id,
        segment_index: t.segment_index,
        actor_id: t.actor_id,
        index: t.idx,
        started_at: t.started_at,
        step_ids: stepIdsByTurn.get(t.id) ?? [],
      };
      if (t.prompt_id !== null) turn.prompt_id = t.prompt_id;
      if (t.mode !== null) turn.mode = t.mode;
      return turn;
    });
    return { summary, segments, actors, turns, steps };
  }

  /** Projected step counts by type for one session. */
  stepCounts(id: string): Record<string, number> {
    const rows = this.db.prepare("SELECT type, count(*) AS n FROM steps WHERE session_id = ? GROUP BY type").all(id) as Array<{ type: string; n: number }>;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.type] = r.n;
    return out;
  }

  counts(): StoreCounts {
    const c = (t: string) => (this.db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    return { sessions: c("sessions"), segments: c("segments"), actors: c("actors"), turns: c("turns"), steps: c("steps") };
  }

  private toSummary(row: SessionRow): SessionSummary {
    const agent: AgentInfo = { kind: row.agent_kind, version: row.agent_version };
    if (row.agent_format_version !== null) agent.format_version = row.agent_format_version;
    const workspace: Workspace = { root: row.workspace_root };
    if (row.workspace_repo !== null) workspace.repo = row.workspace_repo;
    const metrics: SessionMetrics = {
      cost_usd: row.cost_usd,
      api_requests: row.api_requests,
      tokens: { input: row.tokens_input, output: row.tokens_output, cache_read: row.tokens_cache_read, cache_creation: row.tokens_cache_creation },
    };
    const summary: SessionSummary = {
      id: row.id,
      agent,
      workspace,
      owner_id: row.owner_id,
      captured_on: row.captured_on,
      source: row.source,
      started_at: row.started_at,
      ingested_at: row.ingested_at,
      updated_at: row.updated_at,
      steps_total: row.steps_total,
      step_counts: this.stepCounts(row.id),
      failed_count: row.failed_count,
      reference_only_count: row.reference_only_count,
      flag_count: row.flag_count,
      turn_count: row.turn_count,
      metrics,
    };
    if (row.title !== null) summary.title = row.title;
    if (row.ended_at !== null) summary.ended_at = row.ended_at;
    if (row.verdict_state !== null) {
      const verdict: Verdict = { state: row.verdict_state };
      if (row.verdict_note !== null) verdict.note = row.verdict_note;
      if (row.verdict_reviewer !== null) verdict.reviewer = row.verdict_reviewer;
      summary.verdict = verdict;
    }
    return summary;
  }
}

function rowToStep(r: StepRow): Step {
  const base = {
    id: r.id,
    session_id: r.session_id,
    segment_index: r.segment_index,
    turn_id: r.turn_id,
    actor_id: r.actor_id,
    seq: r.seq,
    at: r.at,
    decision: r.decision,
    outcome: r.outcome,
    content_status: r.content_status as Step["content_status"],
    channels: JSON.parse(r.channels) as string[],
    flags: JSON.parse(r.flags) as Step["flags"],
    ...(r.error_type !== null && r.error_message !== null ? { error: { type: r.error_type, message: r.error_message } } : {}),
  };
  const payload: unknown = JSON.parse(r.payload);
  // The type column is the discriminator; payload JSON was written from a typed Step so it matches.
  return { ...base, type: r.type, payload } as Step;
}
