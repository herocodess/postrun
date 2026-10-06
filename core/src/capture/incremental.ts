/**
 * Incremental Claude Code ingest for one open session.
 *
 * Re-reading a session's whole capture folder on every turn makes each turn
 * cost more than the last: at the end of a 12 hour session that is ~300 ms of
 * parsing and fingerprinting per turn, almost all of it for turns that ended
 * hours ago. This keeps the session in memory instead and reads only the bytes
 * added since the previous update.
 *
 * Records of a finished turn (its Stop is older than `sealMs`, so late
 * telemetry has landed) are lightened (adapters/claude-code/light.ts): their
 * bulky content is dropped and a few hundred bytes per event remain. The
 * adapter still runs over the whole session every time, so ordering, turn
 * grouping and hook-only recovery are exactly what a full read produces. Only
 * the steps of unfinished turns carry real content; the others are passed to
 * the store as metadata only, which updates their order or status if those
 * moved and never touches their stored content.
 *
 * The capture files are never modified here; a full read (catch-up on start,
 * the final ingest before clean-up) remains the source of truth.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { adaptClaudeCode } from "../adapters/claude-code/adapter.js";
import { isHookRecord, type HookRecord } from "../adapters/claude-code/hooks.js";
import { lightenEvent, lightenHook } from "../adapters/claude-code/light.js";
import { forEachLine } from "../adapters/claude-code/ndjson.js";
import { flattenOtlpLogs, type OtlpEvent } from "../adapters/claude-code/otlp.js";
import { claudeCodeRecordFrom } from "../store/ingest.js";
import type { SessionRecord } from "../store/types.js";
import { SESSION_HOOKS_FILE, SESSION_OTLP_FILE } from "./layout.js";

/** A turn's records are lightened this long after its Stop, once late telemetry has landed. */
export const SEAL_MS = 2 * 60 * 1000;

export interface IncrementalUpdate {
  record: SessionRecord;
  /** Steps whose payload is not real content: write their order and status only. */
  metaOnly: Set<string>;
  /** Lines read in this update. */
  newLines: number;
}

export class IncrementalSession {
  private hooksOffset = 0;
  private otlpOffset = 0;
  private readonly hooks: HookRecord[] = [];
  private readonly turnOf: string[] = []; // per hook record: its turn key, "" when unknown
  private readonly events: OtlpEvent[] = [];
  private readonly stopAt = new Map<string, number>();
  private readonly sealed = new Set<string>();
  private currentTurn: string | undefined;
  private promptCount = 0;
  /** When this session was last updated, for evicting idle sessions from memory. */
  lastUsed = Date.now();

  constructor(
    readonly dir: string,
    readonly sessionId: string,
    private readonly sealMs = SEAL_MS,
  ) {}

  /** Read what was appended since the last update, lighten finished turns, and build the session. */
  update(now = Date.now()): IncrementalUpdate {
    this.lastUsed = now;
    let newLines = 0;
    const hooksPath = join(this.dir, SESSION_HOOKS_FILE);
    if (existsSync(hooksPath)) {
      this.hooksOffset = forEachLine(
        hooksPath,
        (line) => {
          newLines++;
          let h: unknown;
          try {
            h = JSON.parse(line);
          } catch {
            return; // a spliced concurrent append; a full read skips it too
          }
          if (!isHookRecord(h) || h.payload.session_id !== this.sessionId) return;
          // The same turn the adapter's hook path assigns: the prompt id, else the latest prompt.
          const p = h.payload;
          let turn: string;
          if (p.hook_event_name === "UserPromptSubmit") {
            this.promptCount++;
            this.currentTurn = p.prompt_id ?? `hook-${this.promptCount}`;
            turn = this.currentTurn;
          } else {
            turn = p.prompt_id ?? this.currentTurn ?? "";
          }
          if (p.hook_event_name === "Stop" && turn) this.stopAt.set(turn, Date.parse(h.received_at) || now);
          this.hooks.push(h);
          this.turnOf.push(turn);
        },
        this.hooksOffset,
      );
    }
    const otlpPath = join(this.dir, SESSION_OTLP_FILE);
    if (existsSync(otlpPath)) {
      this.otlpOffset = forEachLine(
        otlpPath,
        (line) => {
          newLines++;
          let w: unknown;
          try {
            w = JSON.parse(line);
          } catch {
            return;
          }
          // Telemetry is never a content source, so it is kept light from the start.
          for (const e of flattenOtlpLogs([w])) if (e.session_id === this.sessionId) this.events.push(lightenEvent(e));
        },
        this.otlpOffset,
      );
    }

    // Build first, from records as they are: a turn whose seal time has just passed still has its full
    // content in this update, including telemetry that landed late. Only turns sealed in an earlier
    // update are metadata only.
    const result = adaptClaudeCode({
      otlpLogs: [],
      otlpEvents: this.events,
      hooks: this.hooks,
      sessionId: this.sessionId,
      sourceFiles: { otlpLogs: SESSION_OTLP_FILE, hooks: SESSION_HOOKS_FILE },
    });
    const record = claudeCodeRecordFrom(result, this.dir);
    const metaOnly = new Set<string>();
    for (const s of record.steps) if (this.sealed.has(s.turn_id.slice("turn:".length))) metaOnly.add(s.id);

    // Then lighten turns that finished long enough ago.
    const newlySealed = new Set<string>();
    for (const [turn, at] of this.stopAt) {
      if (!this.sealed.has(turn) && now - at >= this.sealMs) {
        this.sealed.add(turn);
        newlySealed.add(turn);
      }
    }
    if (newlySealed.size > 0) {
      for (let i = 0; i < this.hooks.length; i++) if (newlySealed.has(this.turnOf[i]!)) this.hooks[i] = lightenHook(this.hooks[i]!);
    }
    return { record, metaOnly, newLines };
  }
}
