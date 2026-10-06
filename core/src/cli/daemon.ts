/**
 * The background process: the telemetry receiver, both watchers and the review
 * app in one Node process, plus start / stop / status around it.
 *
 * `postrun run` is the process itself (what `start`, launchd and systemd run).
 * It writes a pid file, logs to ~/.postrun/postrun.log (rotated at 5 MB) and
 * answers GET /api/health so `status` can tell it is really Postrun.
 */

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createClaudeCodeWatcher } from "../capture/claude-code-watcher.js";
import { createClineWatcher } from "../capture/cline-watcher.js";
import { createOtlpReceiver, OtlpPortInUseError } from "../capture/receiver.js";
import { PAUSED_FILE } from "../capture/layout.js";
import { installHook } from "./hook.js";
import { configureClaudeCode, OTLP_KEY_HEADER, readSettingsEnv } from "../capture/setup.js";
import { join } from "node:path";
import { createPostrunServer, LOCALHOST, PortInUseError } from "../server/server.js";
import { loadOrCreateToken } from "../server/token.js";
import { PostrunStore } from "../store/store.js";
import { ensurePrivateDir, ensurePrivateFile, PRIVATE_FILE_MODE } from "../util/files.js";
import { uiDir, VERSION } from "./assets.js";
import { readConfig, type Paths } from "./paths.js";
import { createControl, gitBranch, type Recorder } from "./control.js";
import type { IngestResult } from "../store/types.js";

const LOG_MAX_BYTES = 5 * 1024 * 1024;

export interface PidInfo {
  pid: number;
  port: number;
  otlpPort: number;
  version: string;
  started_at: string;
}

export function readPid(p: Paths): PidInfo | undefined {
  try {
    const v = JSON.parse(readFileSync(p.pid, "utf8")) as PidInfo;
    return typeof v.pid === "number" ? v : undefined;
  } catch {
    return undefined;
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Whether the process in the pid file is really Postrun. After a crash or a reboot the pid file can
 * name a process id the system has since given to something else; that process must never be
 * signalled. Postrun answers its health route with its own pid, and its command line names it.
 */
export async function isPostrun(info: PidInfo): Promise<boolean> {
  if (!alive(info.pid)) return false;
  const h = await health(info.port);
  if (h?.pid === info.pid) return true;
  try {
    const r = spawnSync("ps", ["-p", String(info.pid), "-o", "command="], { encoding: "utf8", timeout: 2000 });
    return r.status === 0 && /postrun/i.test(r.stdout) && /\brun\b/.test(r.stdout);
  } catch {
    return false;
  }
}

export interface Health {
  ok: boolean;
  version?: string;
  pid?: number;
  telemetry?: string;
  catching_up?: boolean;
}

export async function health(port: number, timeoutMs = 1500): Promise<Health | undefined> {
  try {
    const res = await fetch(`http://${LOCALHOST}:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Health;
    return body.ok === true ? body : undefined;
  } catch {
    return undefined;
  }
}

export interface Status {
  running: boolean;
  pid?: number;
  port: number;
  url: string;
  health?: Health;
}

export async function status(p: Paths): Promise<Status> {
  const info = readPid(p);
  const port = info?.port ?? readConfig(p).port;
  const url = `http://${LOCALHOST}:${port}/`;
  if (!info || !(await isPostrun(info))) return { running: false, port, url };
  const h = await health(port);
  return { running: true, pid: info.pid, port, url, ...(h ? { health: h } : {}) };
}

/** A logger that appends to the log file and rotates it once it passes 5 MB. */
function fileLogger(path: string): (line: string) => void {
  let writes = 0;
  return (line: string) => {
    try {
      if (++writes % 100 === 0 && existsSync(path) && statSync(path).size > LOG_MAX_BYTES) renameSync(path, `${path}.1`);
      appendFileSync(path, `[${new Date().toISOString()}] ${line}\n`, { mode: PRIVATE_FILE_MODE });
    } catch {
      // Logging must never take the recorder down.
    }
  };
}

function rotateIfLarge(path: string): void {
  try {
    if (existsSync(path) && statSync(path).size > LOG_MAX_BYTES) renameSync(path, `${path}.1`);
  } catch {
    // ignore
  }
}

/**
 * Run the recorder and review app in this process until SIGTERM / SIGINT.
 * Resolves with an exit code only when it could not start.
 */
export async function run(p: Paths): Promise<number> {
  ensurePrivateDir(p.home);
  rotateIfLarge(p.log);
  const log = fileLogger(p.log);
  const config = readConfig(p);

  const other = readPid(p);
  if (other && other.pid !== process.pid && alive(other.pid) && (await health(other.port))) {
    log(`already running as pid ${other.pid}; this copy exits`);
    return 0;
  }

  // Starting always records: a pause does not outlive the process (Settings says so).
  const pausedMarker = join(p.captures, PAUSED_FILE);
  rmSync(pausedMarker, { force: true });
  // After an upgrade, the installed hook script is refreshed to the version this process expects.
  if (existsSync(p.hook)) {
    try {
      installHook(p);
    } catch (err) {
      log(`could not refresh the hook script: ${(err as Error).message}`);
    }
  }

  // The telemetry key. Installs from before it existed get it added to Claude Code's settings here,
  // only where those settings already point at Postrun's receiver (Postrun's own keys, nothing else).
  const otlpKey = loadOrCreateToken(p.otlpKey);
  if (config.telemetry) {
    try {
      const env = readSettingsEnv(p.claudeSettings);
      if (typeof env["OTEL_EXPORTER_OTLP_ENDPOINT"] === "string" && env["OTEL_EXPORTER_OTLP_ENDPOINT"] === `http://${LOCALHOST}:${config.otlpPort}` && env["OTEL_EXPORTER_OTLP_HEADERS"] !== `${OTLP_KEY_HEADER}=${otlpKey}`) {
        const r = configureClaudeCode({ captureDir: p.captures, otlpPort: config.otlpPort, settingsPath: p.claudeSettings, script: p.hook, telemetry: true, otlpKey });
        if (r.changed) log("added the telemetry key to Claude Code's settings; Claude Code sessions started before now send no cost data until restarted");
      }
    } catch (err) {
      log(`could not add the telemetry key to Claude Code's settings: ${(err as Error).message}. Run: postrun setup`);
    }
  }

  const store = new PostrunStore({ path: p.db });
  const healthInfo: Record<string, unknown> = { version: VERSION, pid: process.pid, telemetry: config.telemetry ? "starting" : "off (hooks only)", catching_up: true, paused: false };

  // Recording: both watchers, which can be paused, resumed and restarted with new settings.
  let cc: ReturnType<typeof createClaudeCodeWatcher> | undefined;
  let cline: ReturnType<typeof createClineWatcher> | undefined;
  let paused = false;
  let control: ReturnType<typeof createControl> | undefined;
  const afterIngest = (result: IngestResult) => {
    if (result.created) {
      // The branch the project is on as the session starts, read once.
      const root = store.getSessionShell(result.session_id)?.summary.workspace.root ?? "";
      const branch = gitBranch(root);
      if (branch) store.setGitBranch(result.session_id, branch);
    }
    control?.onFailures(result.session_id);
  };
  const startWatchers = () => {
    const hours = readConfig(p).rawLogHours;
    cc = createClaudeCodeWatcher({ captureDir: p.captures, store, log, retainMs: hours > 0 ? hours * 3_600_000 : Infinity, onIngest: afterIngest });
    cline = createClineWatcher({ sessionsDir: p.clineSessions, store, log, onIngest: afterIngest });
    cc.start();
    cline.start();
  };
  const stopWatchers = () => {
    cc?.stop();
    cline?.stop();
    cc = cline = undefined;
  };
  const recorder: Recorder = {
    since: new Date().toISOString(),
    health: healthInfo,
    paused: () => paused,
    pause() {
      paused = true;
      healthInfo["paused"] = true;
      // The hook script checks this file and drops events; telemetry is dropped in the receiver.
      ensurePrivateDir(p.captures);
      writeFileSync(pausedMarker, "", { mode: PRIVATE_FILE_MODE });
      stopWatchers();
      log("recording paused from the review app");
    },
    resume() {
      paused = false;
      healthInfo["paused"] = false;
      rmSync(pausedMarker, { force: true });
      startWatchers();
      recorder.since = new Date().toISOString();
      log("recording resumed");
    },
    restart() {
      stopWatchers();
      startWatchers();
      log("recording restarted with new settings");
    },
  };
  control = createControl({ paths: p, store, recorder, log, port: config.port });

  const app = createPostrunServer({
    port: config.port,
    store,
    uiDir: uiDir(),
    captureDir: p.captures,
    ingestToken: loadOrCreateToken(p.token),
    requireKey: true,
    health: healthInfo,
    control,
  });
  try {
    await app.start();
  } catch (err) {
    log(`could not start the review app: ${err instanceof PortInUseError ? `port ${config.port} is in use by another program` : (err as Error).message}`);
    store.close();
    return 1;
  }
  const pidInfo: PidInfo = { pid: process.pid, port: config.port, otlpPort: config.otlpPort, version: VERSION, started_at: new Date().toISOString() };
  writeFileSync(p.pid, JSON.stringify(pidInfo) + "\n", { mode: PRIVATE_FILE_MODE });
  ensurePrivateFile(p.pid);
  log(`postrun ${VERSION} started (pid ${process.pid}); review app on http://${LOCALHOST}:${config.port}/`);

  const receiver = config.telemetry ? createOtlpReceiver({ captureDir: p.captures, port: config.otlpPort, log: (l) => log(`telemetry: ${l}`), paused: () => paused, key: otlpKey }) : undefined;
  if (receiver) {
    try {
      await receiver.start();
      healthInfo["telemetry"] = "running";
      log(`telemetry receiver on http://${LOCALHOST}:${config.otlpPort}`);
    } catch (err) {
      // Hooks still record every prompt, command, edit and reply; only cost and tokens are missing.
      healthInfo["telemetry"] = err instanceof OtlpPortInUseError ? `port ${config.otlpPort} in use` : "failed";
      log(`telemetry receiver NOT running (${(err as Error).message}); recording from hooks only. Run: postrun doctor`);
    }
  }
  if (config.updateCheck) control.startUpdateChecks();

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`stopping (${signal})`);
    stopWatchers();
    control?.stopUpdateChecks();
    const pidNow = readPid(p);
    if (pidNow?.pid === process.pid) rmSync(p.pid, { force: true });
    void Promise.allSettled([receiver?.stop(), app.stop()]).finally(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    log(`crashed: ${err.stack ?? err.message}`);
    process.exit(1);
  });

  // Catch up after the review app is listening, so `start` can report success straight away.
  setImmediate(() => {
    const t = Date.now();
    startWatchers();
    healthInfo["catching_up"] = false;
    log(`caught up in ${Date.now() - t} ms; recording`);
  });
  return -1;
}

/** Start `postrun run` in the background and wait until it answers. */
export async function start(p: Paths, opts: { waitMs?: number } = {}): Promise<{ started: boolean; already: boolean; status: Status; error?: string }> {
  const before = await status(p);
  if (before.running && before.health) return { started: false, already: true, status: before };

  ensurePrivateDir(p.home);
  rotateIfLarge(p.log);
  const out = openSync(p.log, "a", PRIVATE_FILE_MODE);
  const entry = process.argv[1];
  if (!entry) throw new Error("cannot find the postrun entry script");
  const child = spawn(process.execPath, [...process.execArgv, entry, "run"], { detached: true, stdio: ["ignore", out, out], env: process.env });
  child.unref();
  closeSync(out);

  const deadline = Date.now() + (opts.waitMs ?? 20_000);
  let exited: number | null = null;
  child.on("exit", (code) => (exited = code ?? 1));
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const s = await status(p);
    if (s.running && s.health) return { started: true, already: false, status: s };
    if (exited !== null) break;
  }
  const s = await status(p);
  return { started: false, already: false, status: s, error: lastLogLines(p, 5) };
}

/** Stop the background process. Resolves true when one was running. */
export async function stop(p: Paths, waitMs = 8000): Promise<boolean> {
  const info = readPid(p);
  // A stale pid file (the id now belongs to another program) is removed, and nothing is signalled.
  if (!info || !(await isPostrun(info))) {
    rmSync(p.pid, { force: true });
    return false;
  }
  process.kill(info.pid, "SIGTERM");
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && alive(info.pid)) await new Promise((r) => setTimeout(r, 100));
  if (alive(info.pid)) process.kill(info.pid, "SIGKILL");
  rmSync(p.pid, { force: true });
  return true;
}

export function lastLogLines(p: Paths, n: number): string {
  try {
    return readFileSync(p.log, "utf8").trimEnd().split("\n").slice(-n).join("\n");
  } catch {
    return "";
  }
}
