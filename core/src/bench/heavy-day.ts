/**
 * pnpm --filter @postrun/core bench:heavy [--agents 4] [--cline 2] [--hours 12] [--history-days 5]
 *
 * A very heavy day for the recorder: several Claude Code sessions running in
 * parallel all day (worktrees, several terminals), long Cline sessions beside
 * them, on top of earlier days of history that are still on disk.
 *
 * At checkpoints through the day it rebuilds the capture files as they would
 * be at that hour, laid out the way the recorder keeps them (one folder per
 * session; earlier days' raw files already cleaned up, their sessions in the
 * store), and measures what the recorder does for one Claude Code turn (a
 * Stop) and one Cline update, what an open review tab downloads per live
 * update, how long the session list takes, recorder CPU per hour of work, and
 * disk use. Cline updates are paced the way the watcher paces them (pacer.ts).
 * Synthetic, deterministic, shaped like real captures.
 */

import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { sessionReport } from "../report/index.js";
import { previewStep } from "../server/preview.js";
import { claudeCodeRecord, clineRecord } from "../store/ingest.js";
import { PostrunStore } from "../store/store.js";

const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
const AGENTS = arg("agents", 4);
const CLINE = arg("cline", 2);
const HOURS = arg("hours", 12);
const HISTORY_DAYS = arg("history-days", 5);
const HISTORY_PER_DAY = 6;
const TOOLS_PER_TURN = 12;
const TURN_EVERY_MS = 120_000;

let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const LINE = "src/storage/uploader.ts:41:    await this.s3.putObject(params); // retry with backoff\n";
const text = (bytes: number) => LINE.repeat(Math.max(1, Math.ceil(bytes / LINE.length))).slice(0, Math.floor(bytes));
/** Command output: mostly small, sometimes a test run, now and then a build log. */
const outputSize = () => (rand() < 0.8 ? 500 + rand() * 3000 : rand() < 0.9 ? 10_000 + rand() * 30_000 : 80_000 + rand() * 120_000);

type Timed = { t: number; line: string };

/** A Claude Code session as timed hook and OTLP lines. */
function claudeSession(id: string, startMs: number, turns: number): { hooks: Timed[]; otlp: Timed[]; end: number } {
  const hooks: Timed[] = [];
  const otlp: Timed[] = [];
  let t = startMs;
  let seq = 0;
  const iso = (ms: number) => new Date(ms).toISOString();
  const hook = (event: string, extra: Record<string, unknown>) =>
    hooks.push({
      t,
      line: JSON.stringify({ received_at: iso(t).replace(/\.\d{3}Z$/, "Z"), channel: "hook", payload: { session_id: id, hook_event_name: event, cwd: "/Users/dev/code/acme-api", transcript_path: `/Users/dev/.claude/projects/x/${id}.jsonl`, ...extra } }),
    });
  const events: Array<{ name: string; attrs: Record<string, string | number> }> = [];
  const flush = () => {
    if (!events.length) return;
    otlp.push({
      t,
      line: JSON.stringify({
        received_at: iso(t),
        payload: {
          resourceLogs: [
            {
              resource: { attributes: [{ key: "service.version", value: { stringValue: "2.1.30" } }] },
              scopeLogs: [
                {
                  logRecords: events.map((e) => ({
                    attributes: [
                      { key: "event.name", value: { stringValue: e.name } },
                      { key: "event.sequence", value: { intValue: ++seq } },
                      { key: "event.timestamp", value: { stringValue: iso(t) } },
                      { key: "session.id", value: { stringValue: id } },
                      ...Object.entries(e.attrs).map(([key, v]) => ({ key, value: typeof v === "number" ? { intValue: v } : { stringValue: v } })),
                    ],
                  })),
                },
              ],
            },
          ],
        },
      }),
    });
    events.length = 0;
  };
  hook("SessionStart", { source: "startup" });
  for (let turn = 0; turn < turns; turn++) {
    const pid = `${id}-p${turn}`;
    const turnStart = startMs + turn * TURN_EVERY_MS;
    t = Math.max(t + 1000, turnStart);
    hook("UserPromptSubmit", { prompt_id: pid, prompt: `Turn ${turn}: ${text(200 + rand() * 600)}` });
    events.push({ name: "user_prompt", attrs: { "prompt.id": pid, "message.uuid": `${pid}-u`, prompt: text(300) } });
    for (let k = 0; k < TOOLS_PER_TURN; k++) {
      t += 3000 + rand() * 4000;
      const tid = `${pid}-t${k}`;
      const r = rand();
      if (r < 0.45) {
        hook("PostToolUse", { prompt_id: pid, tool_use_id: tid, tool_name: "Bash", tool_input: { command: "pnpm vitest run src/storage" }, tool_response: { stdout: text(outputSize()), stderr: "" } });
        events.push({ name: "tool_result", attrs: { "prompt.id": pid, tool_use_id: tid, tool_name: "Bash", success: "true", tool_input: text(2000) } });
      } else if (r < 0.75) {
        hook("PostToolUse", { prompt_id: pid, tool_use_id: tid, tool_name: "Read", tool_input: { file_path: "/Users/dev/code/acme-api/src/storage/uploader.ts" }, tool_response: { file: { content: text(4000 + rand() * 20_000) } } });
        events.push({ name: "tool_result", attrs: { "prompt.id": pid, tool_use_id: tid, tool_name: "Read", success: "true", tool_input: text(200) } });
      } else {
        hook("PostToolUse", {
          prompt_id: pid,
          tool_use_id: tid,
          tool_name: "Edit",
          tool_input: { file_path: "/Users/dev/code/acme-api/src/storage/uploader.ts", old_string: text(400), new_string: text(600) },
          tool_response: { filePath: "/Users/dev/code/acme-api/src/storage/uploader.ts", originalFile: text(6000 + rand() * 20_000), structuredPatch: [{ lines: [text(300)] }] },
        });
        events.push({ name: "tool_result", attrs: { "prompt.id": pid, tool_use_id: tid, tool_name: "Edit", success: "true", tool_input: text(2000) } });
      }
      events.push({ name: "api_request", attrs: { "prompt.id": pid, cost_usd: "0.012", input_tokens: 9000, output_tokens: 400 } });
      if (k % 3 === 0) flush();
    }
    t += 2000;
    const reply = text(300 + rand() * 900);
    events.push({ name: "assistant_response", attrs: { "prompt.id": pid, "message.uuid": `${pid}-a`, query_source: "repl_main_thread", response_length: reply.length, response: reply } });
    flush();
    hook("Stop", { prompt_id: pid, last_assistant_message: reply });
  }
  t += 1000;
  hook("SessionEnd", { reason: "exit" });
  return { hooks, otlp, end: t };
}

/** A Cline session as timed messages; Cline rewrites the whole messages file on every message. */
function clineSession(id: string, startMs: number, turns: number): Array<{ t: number; msg: unknown }> {
  const msgs: Array<{ t: number; msg: unknown }> = [];
  let t = startMs;
  let n = 0;
  for (let turn = 0; turn < turns; turn++) {
    t = Math.max(t + 1000, startMs + turn * TURN_EVERY_MS);
    msgs.push({ t, msg: { id: `${id}-${n++}`, role: "user", ts: t, content: [{ type: "text", text: `Turn ${turn}: ${text(400)}` }] } });
    for (let k = 0; k < TOOLS_PER_TURN; k++) {
      t += 3000 + rand() * 4000;
      const use = `${id}-u${n}`;
      const r = rand();
      const [name, input, result] =
        r < 0.45
          ? ["run_commands", { commands: ["pnpm vitest run src/storage"] }, [{ query: "pnpm vitest run", result: text(outputSize()), success: true }]]
          : r < 0.75
            ? ["read_files", { files: [{ path: "/Users/dev/code/acme-api/src/storage/uploader.ts" }] }, [{ query: "uploader.ts", result: text(4000 + rand() * 20_000), success: true }]]
            : ["editor", { path: "/Users/dev/code/acme-api/src/storage/uploader.ts", old_text: text(400), new_text: text(600) }, JSON.stringify({ result: text(1500) })];
      msgs.push({ t, msg: { id: `${id}-${n++}`, role: "assistant", ts: t, content: [{ type: "text", text: text(200) }, { type: "tool_use", id: use, name, input }], metrics: { inputTokens: 9000, outputTokens: 400, cost: 0.012 } } });
      msgs.push({ t: t + 500, msg: { id: `${id}-${n++}`, role: "user", ts: t + 500, content: [{ type: "tool_result", tool_use_id: use, content: result }] } });
    }
    t += 2000;
    msgs.push({ t, msg: { id: `${id}-${n++}`, role: "assistant", ts: t, content: [{ type: "text", text: text(300 + rand() * 900) }], metrics: { inputTokens: 9000, outputTokens: 400, cost: 0.012 } } });
  }
  return msgs;
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(0)} MB`;
const dirSize = (dir: string): number =>
  existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? dirSize(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0) : 0;
const time = <T>(fn: () => T): [T, number] => {
  const a = performance.now();
  const r = fn();
  return [r, performance.now() - a];
};

// ---- build the day -----------------------------------------------------------
const DAY = Date.UTC(2026, 9, 6, 7); // 08:00 Lagos
const history = { hooks: [] as Timed[], otlp: [] as Timed[], ids: [] as string[] };
for (let d = 0; d < HISTORY_DAYS; d++) {
  for (let s = 0; s < HISTORY_PER_DAY; s++) {
    const id = `h${String(d).padStart(2, "0")}${s}0000-0000-4000-8000-000000000000`;
    const c = claudeSession(id, DAY - (HISTORY_DAYS - d) * 86_400_000 + s * 5_400_000, 40);
    history.hooks.push(...c.hooks);
    history.otlp.push(...c.otlp);
    history.ids.push(id);
  }
}
const today = Array.from({ length: AGENTS }, (_, i) => {
  const id = `a${i}000000-1111-4222-8333-444444444444`;
  return { id, ...claudeSession(id, DAY + i * 37_000, Math.floor((HOURS * 3_600_000) / TURN_EVERY_MS)) };
});
const clineToday = Array.from({ length: CLINE }, (_, i) => ({ id: `${1790000000000 + i}_bench${i}`, msgs: clineSession(`c${i}`, DAY + 600_000 + i * 51_000, Math.floor((HOURS * 3_600_000) / TURN_EVERY_MS)) }));

const root = mkdtempSync(join(tmpdir(), "postrun-heavy-"));
const cap = join(root, "captures");
const clineDir = join(root, "cline");
mkdirSync(cap, { recursive: true });
const dbPath = join(root, "postrun.db");
const store = new PostrunStore({ path: dbPath });

/** Write one session's folder as the recorder keeps it. */
const writeSession = (id: string, hooks: Timed[], otlp: Timed[]) => {
  const dir = join(cap, "sessions", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "hooks.ndjson"), hooks.map((x) => x.line).join("\n") + "\n");
  writeFileSync(join(dir, "otlp-logs.ndjson"), otlp.map((x) => x.line).join("\n") + "\n");
};
const write = (cutoff: number) => {
  const upTo = (xs: Timed[]) => xs.filter((x) => x.t <= cutoff);
  for (const s of today) writeSession(s.id, upTo(s.hooks), upTo(s.otlp));
  for (const c of clineToday) {
    const dir = join(clineDir, "sessions", c.id);
    mkdirSync(dir, { recursive: true });
    const messages = c.msgs.filter((m) => m.t <= cutoff).map((m) => m.msg);
    writeFileSync(join(dir, `${c.id}.messages.json`), JSON.stringify({ version: 1, sessionId: c.id, messages }));
  }
};

process.stdout.write(
  `heavy day: ${AGENTS} Claude Code sessions in parallel + ${CLINE} Cline sessions for ${HOURS} h, a turn every ${TURN_EVERY_MS / 60000} min with ${TOOLS_PER_TURN} tool calls each,\n` +
    `on top of ${HISTORY_DAYS} earlier days (${history.ids.length} sessions) still on disk.\n\n`,
);

// History is in the store already, as it would be after earlier days. Its raw folders were
// cleaned up 24 hours after each session ended, so they are not on disk today.
for (const id of history.ids) {
  writeSession(id, history.hooks.filter((h) => h.line.includes(id)), history.otlp.filter((o) => o.line.includes(id)));
  store.ingest(claudeCodeRecord(join(cap, "sessions", id), id));
  rmSync(join(cap, "sessions", id), { recursive: true, force: true });
}

const rows: string[][] = [["hour", "capture files", "store", "CC turn", "Cline update", "live tab download", "session list", "recorder CPU per hour"]];
for (const h of [1, 3, 6, 9, 12].filter((x) => x <= HOURS)) {
  const cutoff = DAY + h * 3_600_000;
  // Every open session is in the store up to the turn before this checkpoint's last one.
  write(cutoff - TURN_EVERY_MS);
  for (const s of today) store.ingest(claudeCodeRecord(join(cap, "sessions", s.id), s.id));
  for (const c of clineToday) store.ingest(clineRecord(join(clineDir, "sessions", c.id, `${c.id}.messages.json`)));
  const target = today[0]!.id;
  const asOf = store.getSessionShell(target)!.summary.updated_at;
  await new Promise((r) => setTimeout(r, 2));
  write(cutoff);

  // One Claude Code turn: read this session's folder, write what changed.
  const [rec, tRead] = time(() => claudeCodeRecord(join(cap, "sessions", target), target));
  const [, tWrite] = time(() => store.ingest(rec));
  const cl = clineToday[0];
  const [, tCline] = cl ? time(() => store.ingest(clineRecord(join(clineDir, "sessions", cl.id, `${cl.id}.messages.json`)))) : [undefined, 0];
  // What an open review tab downloads for that turn: the delta response.
  const shell = store.getSessionShell(target)!;
  const delta = { ...shell, delta: true, reload: false, steps: store.stepsChangedSince(target, asOf).steps.map(previewStep), report: sessionReport(store.reportSteps(target)), as_of: shell.summary.updated_at };
  const apiBytes = Buffer.byteLength(JSON.stringify(delta));
  const [, tList] = time(() => store.listSessions());
  // Per hour: each Claude Code session ends 30 turns. Each Cline session changes on ~26 messages
  // per turn, but the pacer re-reads at most once per max(2 s, cost / 1%).
  const ccPerHour = AGENTS * (3_600_000 / TURN_EVERY_MS);
  const clineChanges = (3_600_000 / TURN_EVERY_MS) * (TOOLS_PER_TURN * 2 + 2);
  const clinePerHour = CLINE * Math.min(clineChanges, 3_600_000 / Math.max(2000, tCline / 0.01));
  const cpuPerHour = (ccPerHour * (tRead + tWrite) + clinePerHour * tCline) / 1000;
  const walSize = existsSync(dbPath + "-wal") ? statSync(dbPath + "-wal").size : 0;
  rows.push([
    `${h}`,
    mb(dirSize(cap)), // Postrun's raw files; Cline's own files are Cline's
    mb(statSync(dbPath).size + walSize),
    `${(tRead + tWrite).toFixed(0)} ms`,
    `${tCline.toFixed(0)} ms`,
    apiBytes < 1024 * 1024 ? `${(apiBytes / 1024).toFixed(0)} KB` : mb(apiBytes),
    `${tList.toFixed(0)} ms`,
    `${cpuPerHour.toFixed(0)} s (${((cpuPerHour / 3600) * 100).toFixed(1)}% of a core)`,
  ]);
  process.stdout.write(`  ${rows[rows.length - 1]!.join(" | ")}\n`);
}

const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
process.stdout.write("\n" + rows.map((r) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ")).join("\n") + "\n");
store.close();
rmSync(root, { recursive: true, force: true });
