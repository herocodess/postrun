/**
 * Local SQLite store for normalized sessions (Node's built-in node:sqlite, via ./sqlite.ts).
 *
 * - Tables follow the v1.2 shape: sessions, segments, actors, turns, steps.
 * - ingest() takes a whole session from a capture: it upserts by
 *   (session_id, id) and removes children the record no longer contains, so
 *   re-ingesting is idempotent and never leaves duplicates. appendBatch() is
 *   the incremental push path and never deletes.
 * - Payloads, channels, and flags are stored as JSON text, faithfully.
 * - Projections (step counts, failed/reference-only/flag counts, title,
 *   turn step_ids) are computed on read, never stored. The one stored total is
 *   the adapter-reported API metrics, because cost events are not steps.
 * - Ownership seam: every session carries owner_id and captured_on. Local MVP
 *   fills a single local owner and this host. No users, auth, or sharing.
 *
 * Default file: ~/.postrun/postrun.db (override with the path option or POSTRUN_DB).
 */

import { createHash } from "node:crypto";
import { Database } from "./sqlite.js";
import { ensurePrivateDir, ensurePrivateFile } from "../util/files.js";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import type { Actor, AgentInfo, Flag, SessionSegment, Step, Turn, Verdict, Workspace } from "../schema/index.js";
import { RISK_KINDS, RISK_RULES_VERSION, withRiskFlags } from "../report/risk.js";
import type { IngestResult, SessionBatch, SessionMetrics, SessionRecord, SessionRefs, SessionSummary, StoreCounts, StoredSession } from "./types.js";

export const LOCAL_OWNER_ID = "local";
/**
 * 1: initial. 2: per-step hash and written_at (write only what changed, deltas
 * for live views); per-session counts kept on the session row; edits no longer
 * hold a full copy of the original file.
 */
export const SCHEMA_VERSION = 4;

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
  updated_at           TEXT NOT NULL,
  -- kept up to date on every write (refreshSummary), so listing never scans steps
  title                TEXT,
  steps_total          INTEGER NOT NULL DEFAULT 0,
  failed_count         INTEGER NOT NULL DEFAULT 0,
  reference_only_count INTEGER NOT NULL DEFAULT 0,
  flag_count           INTEGER NOT NULL DEFAULT 0,
  turn_count           INTEGER NOT NULL DEFAULT 0,
  step_counts          TEXT NOT NULL DEFAULT '{}',
  strip                TEXT NOT NULL DEFAULT '',
  git_branch           TEXT,
  -- when a write last removed steps: a live view older than this reloads instead of applying a delta
  pruned_at            TEXT
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
  hash           TEXT,
  meta_hash      TEXT,
  written_at     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, id)
);
CREATE INDEX IF NOT EXISTS steps_session_seq ON steps(session_id, seq);

-- Sessions deleted by the user. Capture never imports these ids again, and live views learn of the deletion.
CREATE TABLE IF NOT EXISTS deleted_sessions (
  id         TEXT PRIMARY KEY,
  agent_kind TEXT,
  deleted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS steps_session_turn ON steps(session_id, turn_id, seq);
`;

/** Indexes on columns that version 1 stores gain by ALTER TABLE, so they run after the upgrade. */
const DDL_V2_INDEXES = `CREATE INDEX IF NOT EXISTS steps_session_written ON steps(session_id, written_at);
CREATE INDEX IF NOT EXISTS sessions_started ON sessions(started_at DESC, id);
CREATE INDEX IF NOT EXISTS sessions_workspace ON sessions(workspace_root, started_at DESC);
CREATE INDEX IF NOT EXISTS steps_at ON steps(at);`;

/**
 * Search inside sessions: a trigram index (any substring of 3 or more characters) over what a step
 * holds that people search for: the command and the start of its output, the file path and the
 * start of the new text, message text, the tool name. Kept in step with the steps table by
 * triggers, keyed by the step's rowid, so every write path (ingest, push, prune, delete) stays in
 * sync without code of its own.
 */
const FTS_TEXT = `trim(
  coalesce(json_extract(new.payload, '$.command'), '') || ' ' ||
  substr(coalesce(json_extract(new.payload, '$.stdout'), ''), 1, 4000) || ' ' ||
  substr(coalesce(json_extract(new.payload, '$.stderr'), ''), 1, 2000) || ' ' ||
  coalesce(json_extract(new.payload, '$.path'), '') || ' ' ||
  substr(coalesce(json_extract(new.payload, '$.new_string'), ''), 1, 2000) || ' ' ||
  substr(coalesce(json_extract(new.payload, '$.text'), ''), 1, 4000) || ' ' ||
  coalesce(json_extract(new.payload, '$.tool_name'), ''))`;
const DDL_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS steps_fts USING fts5(text, session_id UNINDEXED, seq UNINDEXED, tokenize = 'trigram');
CREATE TRIGGER IF NOT EXISTS steps_fts_insert AFTER INSERT ON steps BEGIN
  INSERT INTO steps_fts (rowid, text, session_id, seq) VALUES (new.rowid, ${FTS_TEXT}, new.session_id, new.seq);
END;
CREATE TRIGGER IF NOT EXISTS steps_fts_update AFTER UPDATE OF payload, seq ON steps BEGIN
  DELETE FROM steps_fts WHERE rowid = old.rowid;
  INSERT INTO steps_fts (rowid, text, session_id, seq) VALUES (new.rowid, ${FTS_TEXT}, new.session_id, new.seq);
END;
CREATE TRIGGER IF NOT EXISTS steps_fts_delete AFTER DELETE ON steps BEGIN
  DELETE FROM steps_fts WHERE rowid = old.rowid;
END;`;
/** Deleted text is overwritten in the index too, as secure_delete does for the tables. A write: run only when unset. */
const FTS_SECURE_DELETE = "INSERT INTO steps_fts (steps_fts, rank) VALUES ('secure-delete', 1)";
const DDL_META = "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)";
/** Steps re-flagged per transaction when the risk rules change: bounded memory, short write locks. */
const RISK_BATCH = 2000;

/** Columns added in version 2, for upgrading a version 1 store in place. */
const V2_COLUMNS: Array<[table: string, column: string, decl: string]> = [
  ["sessions", "title", "TEXT"],
  ["sessions", "steps_total", "INTEGER NOT NULL DEFAULT 0"],
  ["sessions", "failed_count", "INTEGER NOT NULL DEFAULT 0"],
  ["sessions", "reference_only_count", "INTEGER NOT NULL DEFAULT 0"],
  ["sessions", "flag_count", "INTEGER NOT NULL DEFAULT 0"],
  ["sessions", "turn_count", "INTEGER NOT NULL DEFAULT 0"],
  ["sessions", "step_counts", "TEXT NOT NULL DEFAULT '{}'"],
  ["sessions", "pruned_at", "TEXT"],
  ["sessions", "strip", "TEXT NOT NULL DEFAULT ''"],
  ["sessions", "git_branch", "TEXT"],
  ["steps", "hash", "TEXT"],
  ["steps", "meta_hash", "TEXT"],
  ["steps", "written_at", "TEXT NOT NULL DEFAULT ''"],
];

/** One character per step type for the session strip: c command, e edit, r read, m message, o other. */
const STRIP_CHAR = `CASE st.type WHEN 'command' THEN 'c' WHEN 'edit' THEN 'e' WHEN 'read' THEN 'r' WHEN 'message' THEN 'm' ELSE 'o' END`;

export interface DashboardTotals {
  sessions: number;
  steps: number;
  failed: number;
  cost: number;
  /** Sessions with steps and no review yet. */
  unreviewed: number;
  /** Sessions with at least one flag. */
  flagged: number;
}

export interface Dashboard {
  days: number;
  /** Start of the period: local midnight, as an ISO time. */
  from: string;
  totals: DashboardTotals;
  /** The same totals for the period before, for comparison. */
  previous: DashboardTotals;
  /** One entry per local day: steps by kind (a failed step counts under failed only), sessions started and their cost. */
  per_day: Array<{ day: string; command: number; edit: number; read: number; message: number; other: number; failed: number; sessions: number; cost: number }>;
  /** Open sessions written in the last 15 minutes. */
  running: SessionSummary[];
  /** Sessions in the period with failures or flags, not yet marked as looking good. */
  needs_review: SessionSummary[];
  files: Array<{ path: string; edits: number; sessions: number }>;
}

export interface ProjectSummary {
  root: string;
  repo: string | null;
  sessions: number;
  steps: number;
  failed: number;
  flags: number;
  cost: number;
  last_at: string;
  unreviewed: number;
}

/** Largest page querySessions returns. */
export const MAX_PAGE = 500;

export interface SessionQuery {
  agent?: string;
  owner_id?: string;
  /** Matches the first prompt or the workspace path (anywhere), or the session id (from the start). Case-insensitive. */
  q?: string;
  /** Started at or after this ISO time. */
  from?: string;
  /** Started before this ISO time. */
  to?: string;
  minSteps?: number;
  failedOnly?: boolean;
  /** False leaves out sessions with no steps. Default true. */
  includeEmpty?: boolean;
  /** False searches titles, paths and ids only, not step content. Default true (for 3 or more characters). */
  inSteps?: boolean;
  /** Only sessions in this working folder (exact). */
  workspace?: string;
  /** Review state: "none" for not reviewed yet, or a verdict state. */
  verdict?: "none" | "approved" | "needs_attention";
  /** Only sessions with a risk or agent flag. */
  flagged?: boolean;
  /** Page size, 1 to MAX_PAGE. Without it, every match is returned. */
  limit?: number;
  /** next_cursor from the previous page. */
  cursor?: string;
}

export interface SessionPage {
  sessions: SessionSummary[];
  /** Every session matching the filters, across all pages. */
  total: number;
  total_cost: number;
  /** Sessions with no steps that match the other filters (shown or not). */
  empty_count: number;
  next_cursor?: string;
  /**
   * With a search of 3 or more characters: for sessions on this page whose steps matched, the first
   * matching step's seq and the text around the match. \u0001 and \u0002 mark the matched part.
   */
  matches?: Record<string, { seq: number; text: string }>;
}

/** A search as an FTS5 phrase: any substring, nothing in it read as query syntax. */
function ftsPhrase(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

export class BadCursorError extends Error {}

function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString("base64url");
}

function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(v) && typeof v[0] === "string" && typeof v[1] === "string") return { at: v[0], id: v[1] };
  } catch {
    // fall through
  }
  throw new BadCursorError("invalid cursor");
}

/** Slices in the strip a summary carries: enough to draw, small enough for a list of hundreds. */
export const STRIP_SLICES = 64;

/**
 * Shrink a session's full strip to at most STRIP_SLICES characters. Each slice
 * shows the step type it holds most of, in upper case when any step in it
 * failed, so one failure in a long session still shows.
 */
export function sliceStrip(full: string, slices = STRIP_SLICES): string {
  if (full.length <= slices) return full;
  let out = "";
  for (let b = 0; b < slices; b++) {
    const part = full.slice(Math.floor((b * full.length) / slices), Math.floor(((b + 1) * full.length) / slices));
    const counts = new Map<string, number>();
    let failed = false;
    for (const ch of part) {
      const lower = ch.toLowerCase();
      if (ch !== lower) failed = true;
      counts.set(lower, (counts.get(lower) ?? 0) + 1);
    }
    let best = "o";
    let n = -1;
    for (const [k, v] of counts) if (v > n) [best, n] = [k, v];
    out += failed ? best.toUpperCase() : best;
  }
  return out;
}

/** Recompute one session's stored counts from its steps and turns. */
const REFRESH_SUMMARY = `
UPDATE sessions SET
  title = (SELECT json_extract(st.payload, '$.text') FROM steps st
             WHERE st.session_id = sessions.id AND st.type = 'message' AND json_extract(st.payload, '$.role') = 'user'
               AND json_extract(st.payload, '$.text') IS NOT NULL
             ORDER BY st.seq LIMIT 1),
  steps_total = (SELECT count(*) FROM steps st WHERE st.session_id = sessions.id),
  failed_count = (SELECT count(*) FROM steps st WHERE st.session_id = sessions.id AND st.outcome = 'failed'),
  reference_only_count = (SELECT count(*) FROM steps st WHERE st.session_id = sessions.id AND st.content_status = 'reference_only'),
  flag_count = (SELECT coalesce(sum(json_array_length(st.flags)), 0) FROM steps st WHERE st.session_id = sessions.id),
  turn_count = (SELECT count(*) FROM turns t WHERE t.session_id = sessions.id),
  step_counts = (SELECT coalesce(json_group_object(type, n), '{}') FROM (SELECT type, count(*) AS n FROM steps st WHERE st.session_id = sessions.id GROUP BY type)),
  strip = (SELECT coalesce(group_concat(
             CASE WHEN st.outcome = 'failed' THEN upper(${STRIP_CHAR}) ELSE ${STRIP_CHAR} END, '' ORDER BY st.seq), '')
           FROM steps st WHERE st.session_id = sessions.id)
WHERE id = ?`;

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
  // kept up to date on write (REFRESH_SUMMARY)
  title: string | null;
  steps_total: number;
  failed_count: number;
  reference_only_count: number;
  flag_count: number;
  turn_count: number;
  step_counts: string;
  strip: string;
  git_branch: string | null;
  pruned_at: string | null;
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
  hash: string | null;
  written_at: string;
}

const SESSION_SELECT = `SELECT s.* FROM sessions s`;

/** Fingerprint of everything a step row stores, to skip rewriting unchanged steps. */
function stepHash(s: Step): string {
  return createHash("sha1")
    .update(JSON.stringify([s.segment_index, s.turn_id, s.actor_id, s.seq, s.at, s.type, s.decision, s.outcome, s.content_status, s.error ?? null, s.channels, s.payload, s.flags]))
    .digest("base64");
}

/** Fingerprint of a step without its payload: order, turn, status, error, channels, flags. */
function stepMetaHash(s: Step): string {
  return createHash("sha1")
    .update(JSON.stringify([s.segment_index, s.turn_id, s.actor_id, s.seq, s.at, s.type, s.decision, s.outcome, s.content_status, s.error ?? null, s.channels, s.flags]))
    .digest("base64");
}

/** Matches the placeholder light records carry in place of content (adapters/claude-code/light.ts). */
const LIGHT_IN_JSON = JSON.stringify("\u0000postrun:light").slice(1, -1);

export interface IngestOptions {
  /**
   * Steps whose payload is not real content (built from light records): only their order, turn,
   * status, error, channels and flags are updated, and only when those changed. Any step whose
   * payload carries the light placeholder is treated this way regardless.
   */
  metaOnly?: ReadonlySet<string>;
}

/** Raised when capture or a push targets a session the user deleted. */
export class DeletedSessionError extends Error {
  constructor(readonly sessionId: string) {
    super(`session ${sessionId} was deleted; it is not recorded again`);
    this.name = "DeletedSessionError";
  }
}

export class PostrunStore {
  readonly path: string;
  readonly ownerId: string;
  readonly capturedOn: string;
  private readonly db: Database;

  constructor(opts: StoreOptions = {}) {
    this.path = opts.path ?? defaultDbPath();
    this.ownerId = opts.ownerId ?? LOCAL_OWNER_ID;
    this.capturedOn = opts.capturedOn ?? hostname();
    if (this.path !== ":memory:") ensurePrivateDir(dirname(this.path));
    this.db = new Database(this.path);
    if (this.path !== ":memory:") {
      // The store holds full prompts and tool output: owner-only. SQLite gives
      // the -wal and -shm files the database file's mode when it creates them,
      // so tighten the main file before WAL is switched on, and any that exist.
      for (const suffix of ["", "-wal", "-shm"]) ensurePrivateFile(this.path + suffix);
    }
    this.db.pragma("journal_mode = WAL");
    // Deleted or replaced content is overwritten, not just unlinked: deleting a session that held a
    // secret must remove the secret from the file, not leave it in a free page.
    this.db.pragma("secure_delete = ON");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000"); // capture (writer) and serve (reader) share the file
    this.migrate();
  }

  private migrate(): void {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > SCHEMA_VERSION) throw new Error(`${this.path} has schema version ${version}, newer than this build (${SCHEMA_VERSION})`);
    this.db.exec(DDL);
    // Columns added during version 2 development reach any store that lacks them, whatever its version stamp.
    const addMissingColumns = () => {
      for (const [table, column, decl] of V2_COLUMNS) {
        const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!cols.some((c) => c.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
      }
    };
    if (version >= SCHEMA_VERSION) addMissingColumns();
    if (version < SCHEMA_VERSION) {
      this.db.transaction(() => {
        // Version 1 tables predate these columns; CREATE TABLE IF NOT EXISTS above left them as they were.
        addMissingColumns();
        // Edits no longer keep a full copy of the original file; drop the copies already stored.
        this.db.exec(
          `UPDATE steps SET payload = json_remove(payload, '$.structured_patch.originalFile'), hash = NULL
           WHERE type = 'edit' AND json_extract(payload, '$.structured_patch.originalFile') IS NOT NULL`,
        );
        // Version 4: the search index, filled from the steps already stored, and risk flags on them.
        const hadFts = this.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'steps_fts'").get() !== undefined;
        this.db.exec(DDL_FTS);
        if (!hadFts) {
          this.db.exec(`INSERT INTO steps_fts (rowid, text, session_id, seq) SELECT rowid, ${FTS_TEXT.replace(/new\./g, "steps.")}, session_id, seq FROM steps`);
        }
        // Counts, titles and strips projected for every session (older stores lack some of them).
        // Risk flags follow after, in batches: see recomputeRiskFlags.
        const refresh = this.db.prepare(REFRESH_SUMMARY);
        for (const { id } of this.db.prepare("SELECT id FROM sessions").all() as Array<{ id: string }>) refresh.run(id);
        this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
      })();
    }
    this.db.exec(DDL_V2_INDEXES);
    this.db.exec(DDL_FTS);
    this.db.exec(DDL_META);
    const secure = this.db.prepare("SELECT v FROM steps_fts_config WHERE k = 'secure-delete'").get() as { v: unknown } | undefined;
    if (!secure || Number(secure.v) !== 1) this.db.exec(FTS_SECURE_DELETE);
    this.recomputeRiskFlags();
  }

  /**
   * Bring stored risk flags up to the current rules, once per rules version. Only commands, edits
   * and reads can carry them; they are read and rewritten a batch at a time, each batch in its own
   * short transaction, so a large store neither fills memory nor holds the write lock for long.
   * Safe to interrupt: the rules version is recorded only at the end, and recomputing is idempotent.
   */
  private recomputeRiskFlags(): void {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'risk_rules'").get() as { value: string } | undefined;
    if (row && Number(row.value) >= RISK_RULES_VERSION) return;
    const select = this.db.prepare(
      `SELECT st.rowid AS rid, st.session_id AS sid, st.type, st.payload, st.flags, se.workspace_root AS root
       FROM steps st JOIN sessions se ON se.id = st.session_id
       WHERE st.rowid > ? AND st.type IN ('command', 'edit', 'read') ORDER BY st.rowid LIMIT ${RISK_BATCH}`,
    );
    const flag = this.db.prepare("UPDATE steps SET flags = ?, hash = NULL, meta_hash = NULL WHERE rowid = ?");
    const refresh = this.db.prepare(REFRESH_SUMMARY);
    let after = 0;
    for (;;) {
      const rows = select.all(after) as Array<{ rid: number; sid: string; type: string; payload: string; flags: string; root: string }>;
      if (rows.length === 0) break;
      this.db.transaction(() => {
        const touched = new Set<string>();
        for (const r of rows) {
          let next: Flag[];
          try {
            next = withRiskFlags({ type: r.type, payload: JSON.parse(r.payload), flags: JSON.parse(r.flags) as Flag[] } as unknown as Step, r.root).flags;
          } catch {
            continue; // one unreadable row keeps its flags; it must never stop the store from opening
          }
          const json = JSON.stringify(next);
          if (json !== r.flags) {
            flag.run(json, r.rid);
            touched.add(r.sid);
          }
        }
        for (const id of touched) refresh.run(id);
      })();
      after = rows[rows.length - 1]!.rid;
    }
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('risk_rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(RISK_RULES_VERSION));
  }

  close(): void {
    this.db.close();
  }

  // ---- ingest ---------------------------------------------------------------

  ingest(record: SessionRecord, options: IngestOptions = {}): IngestResult {
    if (this.isDeleted(record.id)) throw new DeletedSessionError(record.id);
    const now = new Date().toISOString();
    const run = this.db.transaction((r: SessionRecord): IngestResult => {
      // Checked again under the write lock: a delete that landed after the check above wins.
      if (this.isDeleted(r.id)) throw new DeletedSessionError(r.id);
      const existing = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(r.id) as SessionRow | undefined;
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
          // Bumped below only if something changed, so re-reading an unchanged session wakes no live view.
          updated_at: existing?.updated_at ?? now,
        });

      const { written, missing } = this.writeChildren(r.id, r, now, options.metaOnly, r.workspace.root);
      // A capture record is the whole session, so anything it no longer contains goes. This matters
      // when a session was first read from hooks alone and its OTel data arrives later: the message
      // steps then get their OTel ids, and the hook-based ones must not linger as duplicates.
      const pruned = this.pruneChildren(r, now);
      const rowChanged =
        !existing ||
        existing.ended_at !== (r.ended_at ?? null) ||
        existing.cost_usd !== r.metrics.cost_usd ||
        existing.api_requests !== r.metrics.api_requests ||
        existing.tokens_input !== r.metrics.tokens.input ||
        existing.tokens_output !== r.metrics.tokens.output ||
        existing.agent_version !== r.agent.version ||
        existing.workspace_root !== r.workspace.root ||
        existing.started_at !== r.started_at;
      const changed = rowChanged || written > 0 || pruned > 0;
      if (changed) {
        this.db.prepare(REFRESH_SUMMARY).run(r.id);
        this.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, r.id);
      }

      return {
        session_id: r.id,
        created: !existing,
        changed,
        written,
        ...(missing > 0 ? { missing_content: missing } : {}),
        steps: r.steps.length,
        turns: r.turns.length,
        segments: r.segments.length,
        actors: r.actors.length,
      };
    });
    return run(record);
  }

  // ---- push ingest ------------------------------------------------------------

  /**
   * Merge one pushed batch into a session, creating the session on first push.
   *
   * Unlike ingest(), which replaces a whole session from a capture, a batch is
   * incremental: children are upserted by key and nothing is deleted. On an
   * existing session, ended_at, source, and metrics change only when the batch
   * carries them, so a batch of steps never zeroes the cost or reopens a
   * finished session. The verdict is never touched by a push.
   */
  appendBatch(b: SessionBatch): IngestResult {
    if (this.isDeleted(b.session.id)) throw new DeletedSessionError(b.session.id);
    const now = new Date().toISOString();
    const run = this.db.transaction((batch: SessionBatch): IngestResult => {
      if (this.isDeleted(batch.session.id)) throw new DeletedSessionError(batch.session.id);
      const h = batch.session;
      const existing = this.db.prepare("SELECT ingested_at FROM sessions WHERE id = ?").get(h.id) as { ingested_at: string } | undefined;
      const m = h.metrics;
      this.db
        .prepare(
          `INSERT INTO sessions (id, owner_id, captured_on, agent_kind, agent_version, agent_format_version, workspace_root, workspace_repo,
             started_at, ended_at, source, cost_usd, api_requests, tokens_input, tokens_output, tokens_cache_read, tokens_cache_creation,
             ingested_at, updated_at)
           VALUES (@id, @owner_id, @captured_on, @agent_kind, @agent_version, @agent_format_version, @workspace_root, @workspace_repo,
             @started_at, @ended_at, @source, coalesce(@cost_usd, 0), coalesce(@api_requests, 0), coalesce(@tokens_input, 0),
             coalesce(@tokens_output, 0), coalesce(@tokens_cache_read, 0), coalesce(@tokens_cache_creation, 0), @now, @now)
           ON CONFLICT(id) DO UPDATE SET
             agent_kind = excluded.agent_kind, agent_version = excluded.agent_version,
             agent_format_version = coalesce(@agent_format_version, sessions.agent_format_version),
             workspace_root = excluded.workspace_root, workspace_repo = coalesce(@workspace_repo, sessions.workspace_repo),
             started_at = excluded.started_at,
             ended_at = coalesce(@ended_at, sessions.ended_at),
             source = coalesce(@source_given, sessions.source),
             cost_usd = coalesce(@cost_usd, sessions.cost_usd), api_requests = coalesce(@api_requests, sessions.api_requests),
             tokens_input = coalesce(@tokens_input, sessions.tokens_input), tokens_output = coalesce(@tokens_output, sessions.tokens_output),
             tokens_cache_read = coalesce(@tokens_cache_read, sessions.tokens_cache_read),
             tokens_cache_creation = coalesce(@tokens_cache_creation, sessions.tokens_cache_creation),
             updated_at = @now`,
        )
        .run({
          id: h.id,
          owner_id: this.ownerId,
          captured_on: this.capturedOn,
          agent_kind: h.agent.kind,
          agent_version: h.agent.version,
          agent_format_version: h.agent.format_version ?? null,
          workspace_root: h.workspace.root,
          workspace_repo: h.workspace.repo ?? null,
          started_at: h.started_at,
          ended_at: h.ended_at ?? null,
          source: h.source ?? `push:${h.agent.kind}`,
          source_given: h.source ?? null,
          cost_usd: m?.cost_usd ?? null,
          api_requests: m?.api_requests ?? null,
          tokens_input: m?.tokens.input ?? null,
          tokens_output: m?.tokens.output ?? null,
          tokens_cache_read: m?.tokens.cache_read ?? null,
          tokens_cache_creation: m?.tokens.cache_creation ?? null,
          now,
        });
      const { written } = this.writeChildren(h.id, batch, now, undefined, h.workspace.root);
      this.db.prepare(REFRESH_SUMMARY).run(h.id);
      return {
        session_id: h.id,
        created: !existing,
        changed: true,
        written,
        steps: batch.steps.length,
        turns: batch.turns.length,
        segments: batch.segments.length,
        actors: batch.actors.length,
      };
    });
    return run(b);
  }

  /** What a session already holds, for checking a pushed batch's references before it is written. */
  sessionRefs(id: string): SessionRefs {
    const ids = (sql: string) => (this.db.prepare(sql).all(id) as Array<{ v: string | number }>).map((r) => r.v);
    return {
      exists: this.db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(id) !== undefined,
      segments: new Set(ids("SELECT idx AS v FROM segments WHERE session_id = ?") as number[]),
      actors: new Set(ids("SELECT id AS v FROM actors WHERE session_id = ?") as string[]),
      turns: new Set(ids("SELECT id AS v FROM turns WHERE session_id = ?") as string[]),
      stepIdBySeq: new Map(
        (this.db.prepare("SELECT seq, id FROM steps WHERE session_id = ?").all(id) as Array<{ seq: number; id: string }>).map((r) => [r.seq, r.id]),
      ),
    };
  }

  /** Delete a session's children that are absent from a full record. Only ingest() calls this; pushed batches never delete. Returns steps removed. */
  private pruneChildren(r: SessionRecord, now: string): number {
    const keep = (ids: Array<string | number>) => JSON.stringify(ids);
    const steps = this.db.prepare("DELETE FROM steps WHERE session_id = ? AND id NOT IN (SELECT value FROM json_each(?))").run(r.id, keep(r.steps.map((s) => s.id))).changes;
    if (steps > 0) this.db.prepare("UPDATE sessions SET pruned_at = ? WHERE id = ?").run(now, r.id);
    this.db.prepare("DELETE FROM turns WHERE session_id = ? AND id NOT IN (SELECT value FROM json_each(?))").run(r.id, keep(r.turns.map((t) => t.id)));
    this.db.prepare("DELETE FROM actors WHERE session_id = ? AND id NOT IN (SELECT value FROM json_each(?))").run(r.id, keep(r.actors.map((a) => a.id)));
    this.db.prepare("DELETE FROM segments WHERE session_id = ? AND idx NOT IN (SELECT value FROM json_each(?))").run(r.id, keep(r.segments.map((s) => s.index)));
    return steps;
  }

  /**
   * Upsert children. Steps whose content is unchanged (same hash) are skipped. Returns the number of
   * steps written, and how many metadata-only steps had never been stored with content.
   */
  private writeChildren(
    sessionId: string,
    c: Pick<SessionRecord, "segments" | "actors" | "turns" | "steps">,
    now: string,
    metaOnly: ReadonlySet<string> | undefined,
    workspaceRoot: string,
  ): { written: number; missing: number } {
    const seg = this.db.prepare(
      `INSERT INTO segments (session_id, idx, start_reason, started_at, ended_at, source_files)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, idx) DO UPDATE SET start_reason = excluded.start_reason, started_at = excluded.started_at,
         ended_at = excluded.ended_at, source_files = excluded.source_files`,
    );
    for (const g of c.segments) seg.run(sessionId, g.index, g.start_reason, g.started_at, g.ended_at ?? null, JSON.stringify(g.source_files));

    const act = this.db.prepare(
      `INSERT INTO actors (session_id, id, parent_id, type, label) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, id) DO UPDATE SET parent_id = excluded.parent_id, type = excluded.type, label = excluded.label`,
    );
    for (const a of c.actors) act.run(sessionId, a.id, a.parent_id ?? null, a.type, a.label ?? null);

    const turn = this.db.prepare(
      `INSERT INTO turns (session_id, id, segment_index, actor_id, idx, prompt_id, mode, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, id) DO UPDATE SET segment_index = excluded.segment_index, actor_id = excluded.actor_id, idx = excluded.idx,
         prompt_id = excluded.prompt_id, mode = excluded.mode, started_at = excluded.started_at`,
    );
    for (const t of c.turns) turn.run(sessionId, t.id, t.segment_index, t.actor_id, t.index, t.prompt_id ?? null, t.mode ?? null, t.started_at);

    const step = this.db.prepare(
      `INSERT INTO steps (session_id, id, segment_index, turn_id, actor_id, seq, at, type, decision, outcome, content_status,
         error_type, error_message, channels, payload, flags, hash, meta_hash, written_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, id) DO UPDATE SET segment_index = excluded.segment_index, turn_id = excluded.turn_id,
         actor_id = excluded.actor_id, seq = excluded.seq, at = excluded.at, type = excluded.type, decision = excluded.decision,
         outcome = excluded.outcome, content_status = excluded.content_status, error_type = excluded.error_type,
         error_message = excluded.error_message, channels = excluded.channels, payload = excluded.payload, flags = excluded.flags,
         hash = excluded.hash, meta_hash = excluded.meta_hash, written_at = excluded.written_at`,
    );
    // Metadata only: never touches payload or the content hash.
    const meta = this.db.prepare(
      `UPDATE steps SET segment_index = ?, turn_id = ?, actor_id = ?, seq = ?, at = ?, type = ?, decision = ?, outcome = ?,
         content_status = ?, error_type = ?, error_message = ?, channels = ?, flags = ?, meta_hash = ?, hash = NULL, written_at = ?
       WHERE session_id = ? AND id = ?`,
    );
    // One read of the stored fingerprints, then write only new or changed steps: a long session
    // updated every turn writes that turn's steps, not the whole session again.
    const stored = new Map(
      (
        this.db.prepare("SELECT id, hash, meta_hash, flags FROM steps WHERE session_id = ?").all(sessionId) as Array<{
          id: string;
          hash: string | null;
          meta_hash: string | null;
          flags: string;
        }>
      ).map((r) => [
        r.id,
        r,
      ]),
    );
    let written = 0;
    let missing = 0;
    for (const raw of c.steps) {
      const prev = stored.get(raw.id);
      const payloadJson = metaOnly?.has(raw.id) ? undefined : JSON.stringify(raw.payload);
      const light = payloadJson === undefined || payloadJson.includes(LIGHT_IN_JSON);
      // Risk flags come from content. Without content here, keep the ones stored with it.
      const s: Step = light
        ? ({ ...raw, flags: [...raw.flags.filter((f) => !RISK_KINDS.has(f.kind)), ...(prev ? (JSON.parse(prev.flags) as Flag[]).filter((f) => RISK_KINDS.has(f.kind)) : [])] } as Step)
        : withRiskFlags(raw, workspaceRoot);
      const metaHash = stepMetaHash(s);
      if (light) {
        // No real content here. Update order and status of a stored step if they moved; a step never
        // stored with content is left for a full ingest to write.
        if (!prev) {
          missing++; // no content to write it with: the caller must do a full ingest
          continue;
        }
        if (prev.meta_hash === metaHash) continue;
        meta.run(
          s.segment_index, s.turn_id, s.actor_id, s.seq, s.at, s.type, s.decision, s.outcome, s.content_status,
          s.error?.type ?? null, s.error?.message ?? null, JSON.stringify(s.channels), JSON.stringify(s.flags), metaHash, now, sessionId, s.id,
        );
        written++;
        continue;
      }
      const hash = stepHash(s);
      if (prev?.hash === hash) continue;
      step.run(
        sessionId, s.id, s.segment_index, s.turn_id, s.actor_id, s.seq, s.at, s.type, s.decision, s.outcome, s.content_status,
        s.error?.type ?? null, s.error?.message ?? null, JSON.stringify(s.channels), payloadJson, JSON.stringify(s.flags),
        hash, metaHash, now,
      );
      written++;
    }
    return { written, missing };
  }

  // ---- query ----------------------------------------------------------------

  listSessions(filter: { agent?: string; owner_id?: string } = {}): SessionSummary[] {
    return this.querySessions(filter).sessions;
  }

  /**
   * Sessions, newest first, filtered and optionally a page at a time. With a
   * `limit`, the result carries `next_cursor` when there is more; pass it back
   * as `cursor` for the next page. Totals cover every match, not just the page.
   */
  querySessions(query: SessionQuery = {}): SessionPage {
    const where: string[] = [];
    const params: Record<string, string | number> = {};
    if (query.agent) {
      where.push("s.agent_kind = @agent");
      params["agent"] = query.agent;
    }
    if (query.owner_id) {
      where.push("s.owner_id = @owner_id");
      params["owner_id"] = query.owner_id;
    }
    // Control characters (NUL, the snippet markers) mean nothing in a search and break FTS5 phrases.
    // eslint-disable-next-line no-control-regex
    const text = query.q?.replace(/[\u0000-\u001f\u007f]/g, " ").trim() ?? "";
    const deep = text.length >= 3 && query.inSteps !== false;
    if (text) {
      const inSteps = deep ? " OR s.id IN (SELECT session_id FROM steps_fts WHERE steps_fts MATCH @fts)" : "";
      where.push(`(lower(coalesce(s.title, '')) LIKE @q ESCAPE '\\' OR lower(s.workspace_root) LIKE @q ESCAPE '\\' OR s.id LIKE @qp ESCAPE '\\'${inSteps})`);
      const esc = text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
      params["q"] = `%${esc}%`;
      params["qp"] = `${esc}%`;
      if (deep) params["fts"] = ftsPhrase(text);
    }
    if (query.workspace) {
      where.push("s.workspace_root = @workspace");
      params["workspace"] = query.workspace;
    }
    if (query.verdict === "none") where.push("s.verdict_state IS NULL");
    else if (query.verdict) {
      where.push("s.verdict_state = @verdict");
      params["verdict"] = query.verdict;
    }
    if (query.flagged) where.push("s.flag_count > 0");
    if (query.from) {
      where.push("s.started_at >= @from");
      params["from"] = query.from;
    }
    if (query.to) {
      where.push("s.started_at < @to");
      params["to"] = query.to;
    }
    if (query.minSteps !== undefined && query.minSteps > 0) {
      where.push("s.steps_total >= @min_steps");
      params["min_steps"] = query.minSteps;
    }
    if (query.failedOnly) where.push("s.failed_count > 0");
    // Empty sessions are counted separately, so the list can say how many it is hiding.
    const beforeEmpty = [...where];
    if (query.includeEmpty === false) where.push("s.steps_total > 0");

    const clause = (w: string[]) => (w.length ? ` WHERE ${w.join(" AND ")}` : "");
    const totals = this.db.prepare(`SELECT count(*) AS n, coalesce(sum(s.cost_usd), 0) AS cost FROM sessions s${clause(where)}`).get(params) as { n: number; cost: number };
    const empty = this.db.prepare(`SELECT count(*) AS n FROM sessions s${clause([...beforeEmpty, "s.steps_total = 0"])}`).get(params) as { n: number };

    const page = [...where];
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      page.push("(s.started_at < @c_at OR (s.started_at = @c_at AND s.id > @c_id))");
      params["c_at"] = c.at;
      params["c_id"] = c.id;
    }
    const limit = query.limit !== undefined ? Math.max(1, Math.min(query.limit, MAX_PAGE)) : undefined;
    const sql = `${SESSION_SELECT}${clause(page)} ORDER BY s.started_at DESC, s.id${limit !== undefined ? ` LIMIT ${limit + 1}` : ""}`;
    const rows = this.db.prepare(sql).all(params) as SessionRow[];
    const more = limit !== undefined && rows.length > limit;
    const sessions = (more ? rows.slice(0, limit) : rows).map((row) => this.toSummary(row));
    const last = sessions[sessions.length - 1];
    // Where a search matched inside a session's steps: the first matching step, with the words around it.
    let matches: Record<string, { seq: number; text: string }> | undefined;
    if (deep && sessions.length > 0) {
      matches = {};
      const hit = this.db.prepare(
        "SELECT seq, snippet(steps_fts, 0, '\u0001', '\u0002', '…', 12) AS text FROM steps_fts WHERE steps_fts MATCH ? AND session_id = ? ORDER BY seq LIMIT 1",
      );
      for (const sess of sessions) {
        const h = hit.get(params["fts"], sess.id) as { seq: number; text: string } | undefined;
        if (h) matches[sess.id] = { seq: Number(h.seq), text: h.text.replace(/\s+/g, " ").slice(0, 300) };
      }
    }
    return {
      ...(matches ? { matches } : {}),
      sessions,
      total: totals.n,
      total_cost: totals.cost,
      empty_count: empty.n,
      ...(more && last ? { next_cursor: encodeCursor(last.started_at, last.id) } : {}),
    };
  }

  /** Mark a session reviewed (or clear it with state null). Live views see it as a change. */
  setVerdict(id: string, state: "approved" | "needs_attention" | null, note?: string): boolean {
    const now = new Date().toISOString();
    const r = this.db
      .prepare("UPDATE sessions SET verdict_state = ?, verdict_note = ?, verdict_reviewer = NULL, updated_at = ? WHERE id = ?")
      .run(state, state && note?.trim() ? note.trim().slice(0, 2000) : null, now, id);
    return r.changes > 0;
  }

  /** The git branch a session's working folder was on when it was first recorded. Set once. */
  setGitBranch(id: string, branch: string): void {
    this.db.prepare("UPDATE sessions SET git_branch = ? WHERE id = ? AND git_branch IS NULL").run(branch.slice(0, 200), id);
  }

  /** Recent sessions with no branch recorded yet, for the recorder to fill in. */
  sessionsWithoutBranch(limit = 50): Array<{ id: string; workspace_root: string }> {
    return this.db
      .prepare("SELECT id, workspace_root FROM sessions WHERE git_branch IS NULL AND workspace_root != '' ORDER BY started_at DESC LIMIT ?")
      .all(limit) as Array<{ id: string; workspace_root: string }>;
  }

  /**
   * The dashboard for the `days` days up to now (local time): totals with the previous period
   * for comparison, steps per day by kind, sessions running now, sessions that need a look, and
   * the most edited files.
   */
  dashboard(days: number, now = new Date()): Dashboard {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - days);
    const from = start.toISOString();
    const prevFrom = prevStart.toISOString();
    const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const keys: string[] = [];
    for (let i = 0; i < days; i++) keys.push(dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
    const perDay = new Map(keys.map((k) => [k, { command: 0, edit: 0, read: 0, message: 0, other: 0, failed: 0, sessions: 0, cost: 0 }]));

    const totals = (a: string, b: string) =>
      this.db
        .prepare(
          `SELECT count(*) AS sessions, coalesce(sum(steps_total), 0) AS steps, coalesce(sum(failed_count), 0) AS failed,
             coalesce(sum(cost_usd), 0) AS cost,
             coalesce(sum(CASE WHEN verdict_state IS NULL AND steps_total > 0 THEN 1 ELSE 0 END), 0) AS unreviewed,
             coalesce(sum(CASE WHEN flag_count > 0 THEN 1 ELSE 0 END), 0) AS flagged
           FROM sessions WHERE started_at >= ? AND started_at < ?`,
        )
        .get(a, b) as Dashboard["totals"];
    const end = new Date(now.getTime() + 60_000).toISOString();
    const cur = totals(from, end);
    const prev = totals(prevFrom, from);

    for (const r of this.db.prepare("SELECT started_at, cost_usd FROM sessions WHERE started_at >= ?").all(from) as Array<{ started_at: string; cost_usd: number }>) {
      const d = perDay.get(dayKey(new Date(r.started_at)));
      if (d) {
        d.sessions++;
        d.cost += r.cost_usd;
      }
    }
    // Steps by the local day they happened (a long session can span days), grouped by hour in SQL.
    for (const r of this.db
      .prepare("SELECT substr(at, 1, 13) AS hour, type, outcome, count(*) AS n FROM steps WHERE at >= ? GROUP BY hour, type, outcome")
      .all(from) as Array<{ hour: string; type: string; outcome: string; n: number }>) {
      const t = new Date(`${r.hour}:00:00Z`);
      const d = Number.isNaN(t.getTime()) ? undefined : perDay.get(dayKey(t));
      if (!d) continue;
      if (r.outcome === "failed") d.failed += r.n;
      else if (r.type === "command" || r.type === "edit" || r.type === "read" || r.type === "message") d[r.type] += r.n;
      else d.other += r.n;
    }

    const running = this.db
      .prepare(
        `${SESSION_SELECT} WHERE s.ended_at IS NULL AND s.steps_total > 0 AND s.updated_at >= @cut
           AND (SELECT max(st.at) FROM steps st WHERE st.session_id = s.id) >= @cut
         ORDER BY s.updated_at DESC LIMIT 6`,
      )
      .all({ cut: new Date(now.getTime() - 15 * 60_000).toISOString() }) as SessionRow[];
    const needs = this.db
      .prepare(
        `${SESSION_SELECT} WHERE s.started_at >= ? AND (s.failed_count > 0 OR s.flag_count > 0)
           AND (s.verdict_state IS NULL OR s.verdict_state = 'needs_attention')
         ORDER BY (s.flag_count > 0) DESC, s.started_at DESC LIMIT 6`,
      )
      .all(from) as SessionRow[];
    const files = this.db
      .prepare(
        `SELECT json_extract(payload, '$.path') AS path, count(*) AS edits, count(DISTINCT session_id) AS sessions
         FROM steps WHERE type = 'edit' AND at >= ? AND json_extract(payload, '$.path') IS NOT NULL
         GROUP BY path ORDER BY edits DESC LIMIT 6`,
      )
      .all(from) as Array<{ path: string; edits: number; sessions: number }>;

    return {
      days,
      from,
      totals: cur,
      previous: prev,
      per_day: keys.map((k) => ({ day: k, ...perDay.get(k)! })),
      running: running.map((r) => this.toSummary(r)),
      needs_review: needs.map((r) => this.toSummary(r)),
      files,
    };
  }

  /** Every working folder with recorded steps, most recent first. */
  projects(): ProjectSummary[] {
    return (
      this.db
        .prepare(
          `SELECT workspace_root AS root, max(workspace_repo) AS repo, count(*) AS sessions, coalesce(sum(steps_total), 0) AS steps,
             coalesce(sum(failed_count), 0) AS failed, coalesce(sum(flag_count), 0) AS flags, coalesce(sum(cost_usd), 0) AS cost,
             max(started_at) AS last_at,
             coalesce(sum(CASE WHEN verdict_state IS NULL THEN 1 ELSE 0 END), 0) AS unreviewed
           FROM sessions WHERE steps_total > 0 GROUP BY workspace_root ORDER BY last_at DESC`,
        )
        .all() as ProjectSummary[]
    ).map((p) => ({ ...p, repo: p.repo ?? null }));
  }

  /** One working folder's most edited and read files. */
  projectFiles(root: string, limit = 12): Array<{ path: string; edits: number; reads: number; sessions: number }> {
    return this.db
      .prepare(
        `SELECT json_extract(st.payload, '$.path') AS path, sum(st.type = 'edit') AS edits, sum(st.type = 'read') AS reads,
           count(DISTINCT st.session_id) AS sessions
         FROM steps st JOIN sessions se ON se.id = st.session_id
         WHERE se.workspace_root = ? AND st.type IN ('edit', 'read') AND json_extract(st.payload, '$.path') IS NOT NULL
         GROUP BY path ORDER BY edits DESC, reads DESC LIMIT ?`,
      )
      .all(root, limit) as Array<{ path: string; edits: number; reads: number; sessions: number }>;
  }

  /**
   * Delete every recorded session, overwritten on disk. Each is remembered as deleted, so it is not
   * recorded again; new sessions are. Returns how many sessions were removed.
   */
  deleteAll(): number {
    const n = (this.db.prepare("SELECT count(*) AS n FROM sessions").get() as { n: number }).n;
    this.db.transaction(() => {
      // Remembered as deleted, as one-by-one deletes are, so an agent's own copy (Cline's task store) is not read back in.
      this.db.prepare("INSERT OR REPLACE INTO deleted_sessions (id, agent_kind, deleted_at) SELECT id, agent_kind, ? FROM sessions").run(new Date().toISOString());
      for (const t of ["steps", "turns", "actors", "segments", "sessions"]) this.db.exec(`DELETE FROM ${t}`);
    })();
    try {
      this.db.exec("INSERT INTO steps_fts (steps_fts) VALUES ('optimize')");
      this.db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // another connection is busy; the content is already overwritten
    }
    return n;
  }

  /** Write a consistent copy of the whole store to `path`, which must not exist yet. */
  backupTo(path: string): void {
    this.db.prepare("VACUUM INTO ?").run(path);
  }

  /** A session's last `n` steps, newest first: seq and outcome only. */
  lastSteps(id: string, n: number): Array<{ seq: number; outcome: string }> {
    return this.db.prepare("SELECT seq, outcome FROM steps WHERE session_id = ? ORDER BY seq DESC LIMIT ?").all(id, n) as Array<{ seq: number; outcome: string }>;
  }

  /** Agent kinds that have at least one session. */
  agentKinds(): string[] {
    return (this.db.prepare("SELECT DISTINCT agent_kind AS k FROM sessions ORDER BY agent_kind").all() as Array<{ k: string }>).map((r) => r.k);
  }

  getSession(id: string): StoredSession | undefined {
    const shell = this.getSessionShell(id);
    if (!shell) return undefined;
    const steps = (this.db.prepare("SELECT * FROM steps WHERE session_id = ? ORDER BY seq").all(id) as StepRow[]).map(rowToStep);
    return { ...shell, steps };
  }

  /** A session without its steps' contents: summary, segments, actors and turns (with step ids). Cheap at any size. */
  getSessionShell(id: string): Omit<StoredSession, "steps"> | undefined {
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
    const stepIdsByTurn = new Map<string, string[]>();
    for (const s of this.db.prepare("SELECT id, turn_id FROM steps WHERE session_id = ? ORDER BY seq").all(id) as Array<{ id: string; turn_id: string }>) {
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
    return { summary, segments, actors, turns };
  }

  /**
   * Sessions whose row changed at or after a timestamp, oldest first. Every
   * write path (ingest, appendBatch) bumps sessions.updated_at in the same
   * transaction as the children, so this sees writes from any process.
   */
  changedSince(since: string): Array<{ id: string; updated_at: string }> {
    // Deletions count as changes, so live views drop a deleted session.
    return this.db
      .prepare(
        `SELECT id, updated_at FROM sessions WHERE updated_at >= ?
         UNION ALL SELECT id, deleted_at AS updated_at FROM deleted_sessions WHERE deleted_at >= ?
         ORDER BY updated_at, id`,
      )
      .all(since, since) as Array<{ id: string; updated_at: string }>;
  }

  /** Latest updated_at across all sessions, or undefined for an empty store. */
  lastUpdatedAt(): string | undefined {
    const row = this.db.prepare("SELECT max(m) AS m FROM (SELECT max(updated_at) AS m FROM sessions UNION ALL SELECT max(deleted_at) FROM deleted_sessions)").get() as {
      m: string | null;
    };
    return row.m ?? undefined;
  }

  /**
   * Delete a session and everything recorded for it, and remember the id so capture never imports it
   * again. Content is overwritten on disk (secure_delete) and the write-ahead log is checkpointed and
   * truncated, so the deleted text does not linger in either file. Returns undefined if no such session.
   */
  deleteSession(id: string): { id: string; agent_kind: string; deleted_at: string } | undefined {
    const deleted_at = new Date().toISOString();
    const result = this.db.transaction(() => {
      const row = this.db.prepare("SELECT agent_kind FROM sessions WHERE id = ?").get(id) as { agent_kind: string } | undefined;
      if (!row) return undefined;
      for (const t of ["steps", "turns", "actors", "segments"]) this.db.prepare(`DELETE FROM ${t} WHERE session_id = ?`).run(id);
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
      this.db.prepare("INSERT OR REPLACE INTO deleted_sessions (id, agent_kind, deleted_at) VALUES (?, ?, ?)").run(id, row.agent_kind, deleted_at);
      return { id, agent_kind: row.agent_kind, deleted_at };
    })();
    if (result && this.path !== ":memory:") {
      // Old page images of the deleted rows live in the WAL until a checkpoint. Another process holding
      // a read transaction can delay it; the next checkpoint then finishes the job.
      try {
        this.db.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        /* busy: SQLite checkpoints again on its own */
      }
    }
    return result;
  }

  /** Whether the user deleted this session; capture skips such ids. */
  isDeleted(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM deleted_sessions WHERE id = ?").get(id) !== undefined;
  }

  /**
   * Steps of one session written after `since` (an ISO time from an earlier read), in seq order.
   * `reload` is true when steps were removed since then, so the caller must refetch the whole session.
   */
  stepsChangedSince(id: string, since: string): { steps: Step[]; reload: boolean } {
    const row = this.db.prepare("SELECT pruned_at FROM sessions WHERE id = ?").get(id) as { pruned_at: string | null } | undefined;
    if (!row) return { steps: [], reload: true };
    if (row.pruned_at !== null && row.pruned_at > since) return { steps: [], reload: true };
    const steps = (this.db.prepare("SELECT * FROM steps WHERE session_id = ? AND written_at > ? ORDER BY seq").all(id, since) as StepRow[]).map(rowToStep);
    return { steps, reload: false };
  }

  /**
   * The fields the session report needs (type, outcome, content status, path, command, exit code),
   * pulled out by SQLite without loading any output, so live views can refresh the report cheaply.
   */
  reportSteps(id: string): Step[] {
    const rows = this.db
      .prepare(
        `SELECT id, seq, type, outcome, content_status,
           json_extract(payload, '$.path') AS path, json_extract(payload, '$.is_full_write') AS full_write,
           json_extract(payload, '$.command') AS command, json_extract(payload, '$.exit_code') AS exit_code
         FROM steps WHERE session_id = ? ORDER BY seq`,
      )
      .all(id) as Array<{ id: string; seq: number; type: string; outcome: string; content_status: string; path: string | null; full_write: number | null; command: string | null; exit_code: number | null }>;
    return rows.map((r) => {
      const payload: Record<string, unknown> = {};
      if (r.path !== null) payload["path"] = r.path;
      if (r.full_write !== null) payload["is_full_write"] = r.full_write === 1;
      if (r.command !== null) payload["command"] = r.command;
      if (r.exit_code !== null) payload["exit_code"] = r.exit_code;
      return { id: r.id, seq: r.seq, type: r.type, outcome: r.outcome, content_status: r.content_status, payload } as unknown as Step;
    });
  }

  /** One step, in full. */
  getStep(sessionId: string, stepId: string): Step | undefined {
    const row = this.db.prepare("SELECT * FROM steps WHERE session_id = ? AND id = ?").get(sessionId, stepId) as StepRow | undefined;
    return row ? rowToStep(row) : undefined;
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
      step_counts: JSON.parse(row.step_counts || "{}") as Record<string, number>,
      strip: sliceStrip(row.strip ?? ""),
      failed_count: row.failed_count,
      reference_only_count: row.reference_only_count,
      flag_count: row.flag_count,
      turn_count: row.turn_count,
      metrics,
    };
    if (row.title !== null) summary.title = row.title;
    if (row.git_branch) summary.git_branch = row.git_branch;
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
