/**
 * Report projections over a session's steps. Computed on read, never stored.
 *
 * - files: every path created, edited, or read, with counts and failures
 * - commands: every command run, deduplicated by command text, with counts,
 *   failures, reference-only output, and exit codes
 */

import type { Step } from "../schema/index.js";

export interface FileTouch {
  path: string;
  created: number;
  edited: number;
  read: number;
  failed: number;
  first_seq: number;
}

export interface CommandRun {
  command: string;
  count: number;
  failed: number;
  reference_only: number;
  exit_codes: number[];
  first_seq: number;
}

export interface SessionReport {
  files: FileTouch[];
  commands: CommandRun[];
  counts: {
    files_touched: number;
    files_created: number;
    files_edited: number;
    files_read: number;
    commands_run: number;
    commands_failed: number;
    commands_reference_only: number;
    steps_failed: number;
    steps_reference_only: number;
  };
}

export function sessionReport(steps: Step[]): SessionReport {
  const files = new Map<string, FileTouch>();
  const commands = new Map<string, CommandRun>();
  let stepsFailed = 0;
  let stepsRefOnly = 0;

  const touch = (path: string, seq: number): FileTouch => {
    let f = files.get(path);
    if (!f) {
      f = { path, created: 0, edited: 0, read: 0, failed: 0, first_seq: seq };
      files.set(path, f);
    }
    return f;
  };

  for (const s of steps) {
    if (s.outcome === "failed") stepsFailed++;
    if (s.content_status === "reference_only") stepsRefOnly++;
    if (s.type === "edit") {
      const f = touch(s.payload.path || "(path unknown)", s.seq);
      if (s.payload.is_full_write) f.created++;
      else f.edited++;
      if (s.outcome === "failed") f.failed++;
    } else if (s.type === "read") {
      const f = touch(s.payload.path || "(path unknown)", s.seq);
      f.read++;
      if (s.outcome === "failed") f.failed++;
    } else if (s.type === "command") {
      const key = s.payload.command ?? "(command not inline)";
      let c = commands.get(key);
      if (!c) {
        c = { command: key, count: 0, failed: 0, reference_only: 0, exit_codes: [], first_seq: s.seq };
        commands.set(key, c);
      }
      c.count++;
      if (s.outcome === "failed") c.failed++;
      if (s.content_status === "reference_only") c.reference_only++;
      if (s.payload.exit_code !== undefined && !c.exit_codes.includes(s.payload.exit_code)) c.exit_codes.push(s.payload.exit_code);
    }
  }

  // Written files first (created or edited), then read-only, each by first appearance.
  const fileList = [...files.values()].sort((a, b) => {
    const aw = a.created + a.edited > 0 ? 0 : 1;
    const bw = b.created + b.edited > 0 ? 0 : 1;
    return aw - bw || a.first_seq - b.first_seq;
  });
  const commandList = [...commands.values()].sort((a, b) => a.first_seq - b.first_seq);

  return {
    files: fileList,
    commands: commandList,
    counts: {
      files_touched: fileList.length,
      files_created: fileList.filter((f) => f.created > 0).length,
      files_edited: fileList.filter((f) => f.edited > 0).length,
      files_read: fileList.filter((f) => f.read > 0).length,
      commands_run: commandList.reduce((n, c) => n + c.count, 0),
      commands_failed: commandList.reduce((n, c) => n + c.failed, 0),
      commands_reference_only: commandList.reduce((n, c) => n + c.reference_only, 0),
      steps_failed: stepsFailed,
      steps_reference_only: stepsRefOnly,
    },
  };
}
