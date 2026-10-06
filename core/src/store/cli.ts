/**
 * pnpm ingest --agent claude-code [<captures-dir>] [--session <id>]
 * pnpm ingest --agent cline <session-id | dir | messages.json>
 * pnpm sessions [--agent <kind>]
 * pnpm delete <session-id> [--yes]
 *
 * --db <path> or POSTRUN_DB overrides ~/.postrun/postrun.db.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { listCaptureSessions, loadCaptureDir } from "../adapters/claude-code/index.js";
import { isSafeId, sessionDir, sessionsDir } from "../capture/layout.js";
import { claudeCodeRecord, clineRecord } from "./ingest.js";
import { PostrunStore, defaultDbPath } from "./store.js";

interface Flags {
  positional: string[];
  agent?: string;
  session?: string;
  db?: string;
  yes?: boolean;
}

function parse(argv: string[]): Flags {
  const f: Flags = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--agent") f.agent = next();
    else if (a.startsWith("--agent=")) f.agent = a.slice(8);
    else if (a === "--session") f.session = next();
    else if (a.startsWith("--session=")) f.session = a.slice(10);
    else if (a === "--db") f.db = next();
    else if (a.startsWith("--db=")) f.db = a.slice(5);
    else if (a === "--yes" || a === "-y") f.yes = true;
    else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
    else f.positional.push(a);
  }
  return f;
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  let f: Flags;
  try {
    f = parse(rest);
  } catch (err) {
    process.stderr.write(`postrun store: ${(err as Error).message}\n`);
    return 2;
  }
  const dbPath = f.db ? resolve(f.db) : defaultDbPath();
  const store = new PostrunStore({ path: dbPath });
  try {
    if (command === "ingest") {
      const agent = f.agent ?? "claude-code";
      if (agent !== "claude-code" && agent !== "cline") {
        process.stderr.write(`postrun store: unknown --agent "${agent}"; expected claude-code or cline\n`);
        return 2;
      }
      const target = f.positional[0];
      const records =
        agent === "cline"
          ? [clineRecord(target ?? missing("cline needs a session id, directory, or messages file"))]
          : (() => {
              // A live capture directory holds many sessions; without --session, ingest all of them.
              const dir = resolve(target ?? join(homedir(), ".postrun", "captures"));
              // Per-session folders (sessions/<id>/), as capture writes them; or a flat directory of shared files.
              const folders = existsSync(sessionsDir(dir)) ? readdirSync(sessionsDir(dir)).filter(isSafeId) : [];
              if (folders.length > 0) {
                const ids = f.session !== undefined ? [f.session] : folders;
                return ids.map((id) => claudeCodeRecord(sessionDir(dir, id), id));
              }
              const loaded = loadCaptureDir(dir); // one read for every session
              const ids = f.session !== undefined ? [f.session] : listCaptureSessions(dir, loaded);
              if (ids.length === 0) missing(`no sessions in ${dir} (sessions/, hooks.ndjson or otlp-logs.ndjson)`);
              return ids.map((id) => claudeCodeRecord(dir, id, loaded));
            })();
      for (const record of records) {
        if (store.isDeleted(record.id)) {
          process.stdout.write(`skipped ${record.agent.kind} session ${record.id}: you deleted it\n`);
          continue;
        }
        const r = store.ingest(record);
        process.stdout.write(
          `${r.created ? "ingested" : "updated"} ${record.agent.kind} session ${r.session_id}: ${r.steps} steps, ${r.turns} turns, ${r.segments} segments, ${r.actors} actors -> ${dbPath}\n`,
        );
      }
      const c = store.counts();
      process.stdout.write(`store totals: sessions=${c.sessions} segments=${c.segments} actors=${c.actors} turns=${c.turns} steps=${c.steps}\n`);
      return 0;
    }
    if (command === "list") {
      const filter = f.agent ? { agent: f.agent } : {};
      const rows = store.listSessions(filter);
      if (rows.length === 0) {
        process.stdout.write(`no sessions in ${dbPath}\n`);
        return 0;
      }
      for (const s of rows) {
        const counts = Object.entries(s.step_counts)
          .sort(([, a], [, b]) => b - a)
          .map(([t, n]) => `${t}=${n}`)
          .join(" ");
        process.stdout.write(
          `${s.started_at}  ${s.agent.kind.padEnd(11)} ${s.id.padEnd(38)} ${s.workspace.root}\n` +
            `    ${s.steps_total} steps (${counts}); ${s.turn_count} turns; failed=${s.failed_count} ref-only=${s.reference_only_count} flags=${s.flag_count}; $${s.metrics.cost_usd.toFixed(4)}\n` +
            (s.title ? `    "${s.title.split("\n")[0]?.slice(0, 100)}"\n` : ""),
        );
      }
      return 0;
    }
    if (command === "delete") {
      const id = f.positional[0] ?? missing("delete needs a session id (see pnpm sessions)");
      const s = store.getSessionShell(id);
      if (!s) {
        process.stderr.write(store.isDeleted(id) ? `session ${id} was already deleted\n` : `no session ${id} in ${dbPath}\n`);
        return 1;
      }
      const captureDir = process.env["POSTRUN_CAPTURE_DIR"] ?? join(homedir(), ".postrun", "captures");
      const raw = s.summary.agent.kind === "claude-code" && isSafeId(id) ? sessionDir(captureDir, id) : undefined;
      const title = (s.summary.title ?? "").split("\n")[0]?.slice(0, 80) ?? "";
      if (!f.yes) {
        process.stdout.write(
          `This deletes ${s.summary.agent.kind} session ${id}${title ? ` ("${title}")` : ""}: ${s.summary.steps_total} steps from ${dbPath}` +
            `${raw && existsSync(raw) ? `, and its raw files in ${raw}` : ""}. It cannot be undone.\nRun again with --yes to delete it.\n`,
        );
        return 1;
      }
      store.deleteSession(id);
      if (raw) rmSync(raw, { recursive: true, force: true });
      process.stdout.write(`deleted ${s.summary.agent.kind} session ${id}. Postrun will not record it again.\n`);
      process.stdout.write(
        s.summary.agent.kind === "cline"
          ? "Cline keeps its own copy in ~/.cline/data/sessions; delete it in Cline if you want it gone there too.\n"
          : "Claude Code keeps its own transcript under ~/.claude/projects; delete it there if you want it gone too.\n",
      );
      return 0;
    }
    process.stderr.write("usage: postrun store <ingest|list|delete> [--agent claude-code|cline] [--session <id>] [--db <path>] [--yes] [target]\n");
    return 2;
  } catch (err) {
    process.stderr.write(`postrun store: ${(err as Error).message}\n`);
    return 1;
  } finally {
    store.close();
  }
}

function missing(msg: string): never {
  throw new Error(msg);
}

process.exitCode = main(process.argv.slice(2));
