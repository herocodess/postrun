/**
 * What the background process lets the review app see and change: status,
 * the doctor's checks, settings, pausing, setup, deleting everything. Also
 * the two opt-in extras: failure notifications and the update check.
 *
 * The server calls these through AppControl (server/api.ts). Recording itself
 * (the watchers) is owned by daemon.ts and driven through `recorder`.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { INBOX_FILE, ROTATING_SUFFIX, ROUTER_STATE_FILE, sessionsDir, spoolDir } from "../capture/layout.js";
import { configureClaudeCode, describeConfigure, foreignTelemetry, isClaudeCodeConfigured, readSettingsEnv } from "../capture/setup.js";
import type { AppControl, AppSettings, AppStatus, FeedbackPayload } from "../server/api.js";
import { LOCALHOST } from "../server/server.js";
import type { PostrunStore } from "../store/store.js";
import { VERSION } from "./assets.js";
import { installHook } from "./hook.js";
import { loadOrCreateToken } from "../server/token.js";
import { readConfig, writeConfig, type Paths } from "./paths.js";
import { forgetAccount, readAccount, revokeOnServer, sendFeedback, ShareFailed, shareServer, startBrowserLogin, uploadReport, whoAmI, writeAccount, type BrowserLogin } from "../share/client.js";
import { installService, removeService, serviceState } from "./service.js";

export interface Recorder {
  paused(): boolean;
  pause(): void;
  resume(): void;
  /** Restart recording with the current config (after the raw-log setting changes). */
  restart(): void;
  since: string;
  health: Record<string, unknown>;
}

function bytes(path: string): number {
  try {
    const st = statSync(path);
    if (!st.isDirectory()) return st.size;
    let n = 0;
    for (const e of readdirSync(path)) n += bytes(join(path, e));
    return n;
  } catch {
    return 0;
  }
}

function newest(path: string): number | undefined {
  try {
    const st = statSync(path);
    if (!st.isDirectory()) return st.mtimeMs;
    let best: number | undefined;
    for (const e of readdirSync(path)) {
      const t = newest(join(path, e));
      if (t !== undefined && (best === undefined || t > best)) best = t;
    }
    return best ?? st.mtimeMs;
  } catch {
    return undefined;
  }
}

/** A desktop notification, best effort: osascript on macOS, notify-send on Linux. */
export function notify(title: string, body: string): void {
  const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const cmd =
    process.platform === "darwin"
      ? ["osascript", ["-e", `display notification "${q(body)}" with title "${q(title)}"`]]
      : process.platform === "linux"
        ? // "--": a session title starting with "-" is text, never an option.
          ["notify-send", ["--app-name=Postrun", "--", title, body]]
        : undefined;
  if (!cmd) return;
  try {
    const child = spawn(cmd[0] as string, cmd[1] as string[], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // no notifier on this system
  }
}

/** Compare dotted versions numerically: is `a` newer than `b`? */
export function newerVersion(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/**
 * A regular file's text, only when it is small. A repository an agent worked on is not trusted:
 * HEAD could be a link to /dev/zero (endless) or a FIFO (blocks forever), which would take the
 * background process down. Those are not regular files, and nothing past 4 KB is read.
 */
function smallFile(path: string): string | undefined {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > 4096) return undefined;
    return readFileSync(path, "utf8").slice(0, 4096);
  } catch {
    return undefined;
  }
}

/**
 * The branch a working folder is on now, or undefined when it is not a git repository or HEAD is
 * detached. Read from .git/HEAD directly: running git inside a repository an agent worked on could
 * run that repository's own configuration (fsmonitor and the like), and on a Mac without developer
 * tools it pops an install dialog. Worktrees and submodules (.git is a file) are followed.
 */
export function gitBranch(root: string): string | undefined {
  if (!root || !existsSync(root)) return undefined;
  let dir = resolve(root);
  for (let i = 0; i < 64; i++) {
    const dotGit = join(dir, ".git");
    try {
      const st = statSync(dotGit);
      let gitDir = dotGit;
      if (st.isFile()) {
        const text = smallFile(dotGit);
        const m = text === undefined ? null : /^gitdir:\s*(.+)$/m.exec(text);
        if (!m) return undefined;
        gitDir = resolve(dir, (m[1] as string).trim());
      } else if (!st.isDirectory()) {
        return undefined;
      }
      const head = smallFile(join(gitDir, "HEAD"))?.trim();
      if (head === undefined) return undefined;
      const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
      const branch = ref?.[1]?.trim();
      // Only a plain branch name reaches the store and the page.
      return branch && /^[\w./+-]{1,200}$/.test(branch) ? branch : undefined;
    } catch {
      // no .git here: look in the parent folder
    }
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
  return undefined;
}

export interface ControlDeps {
  paths: Paths;
  store: PostrunStore;
  recorder: Recorder;
  log: (line: string) => void;
  port: number;
}

export function createControl(d: ControlDeps): AppControl & { startUpdateChecks(): void; stopUpdateChecks(): void; onFailures(sessionId: string): void } {
  const { paths: p, store } = d;
  let update: AppStatus["update"];
  let timer: ReturnType<typeof setInterval> | undefined;
  const notified = new Map<string, number>(); // session -> step seq already notified about
  // A sign-in started from the review app, waiting for the person to approve it in the browser.
  let pendingLogin: BrowserLogin | undefined;
  const UA = `postrun/${VERSION} (${process.platform}; review app)`;

  const checkUpdate = async () => {
    try {
      const res = await fetch("https://registry.npmjs.org/postrun/latest", { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
      if (!res.ok) return;
      const latest = String(((await res.json()) as { version?: unknown }).version ?? "");
      if (!latest) return;
      update = { current: VERSION, latest, newer: newerVersion(latest, VERSION), checked_at: new Date().toISOString() };
      if (update.newer) d.log(`update: Postrun ${latest} is available (this is ${VERSION})`);
    } catch {
      // offline or blocked: try again tomorrow
    }
  };

  const settings = (): AppSettings => {
    const c = readConfig(p);
    return { autostart: serviceState().installed, raw_log_hours: c.rawLogHours, notify_failures: c.notifyFailures, update_check: c.updateCheck };
  };

  const status = async (): Promise<AppStatus> => {
    const c = readConfig(p);
    const svc = serviceState();
    const claudeDir = join(p.claudeSettings, "..");
    const ccLast = Math.max(newest(join(p.captures, INBOX_FILE)) ?? 0, newest(spoolDir(p.captures)) ?? 0, newest(sessionsDir(p.captures)) ?? 0);
    const storeBytes = bytes(p.db) + bytes(`${p.db}-wal`) + bytes(`${p.db}-shm`);
    const rawBytes = bytes(p.captures);
    const counts = store.counts();
    const foreign = foreignTelemetry(readSettingsEnv(p.claudeSettings));
    return {
      version: VERSION,
      pid: process.pid,
      address: `http://${LOCALHOST}:${d.port}/`,
      recording: {
        paused: d.recorder.paused(),
        since: d.recorder.since,
        ...(ccLast > 0 ? { last_activity: new Date(ccLast).toISOString() } : {}),
        telemetry: String(d.recorder.health["telemetry"] ?? "unknown"),
        catching_up: d.recorder.health["catching_up"] === true,
      },
      agents: {
        claude_code: {
          found: existsSync(claudeDir),
          configured: existsSync(claudeDir) && isClaudeCodeConfigured({ captureDir: p.captures, otlpPort: c.otlpPort, settingsPath: p.claudeSettings, script: p.hook, telemetry: c.telemetry }),
          mode: c.telemetry && !foreign ? "telemetry" : "hooks only",
          settings_path: p.claudeSettings,
          ...(ccLast > 0 ? { last_activity: new Date(ccLast).toISOString() } : {}),
        },
        cline: { found: existsSync(p.clineSessions), dir: p.clineSessions },
      },
      storage: { home: p.home, total_bytes: bytes(p.home), store_bytes: storeBytes, raw_bytes: rawBytes, sessions: counts.sessions },
      autostart: { supported: svc.supported, ...(svc.reason ? { reason: svc.reason } : {}) },
      settings: { autostart: svc.installed, raw_log_hours: c.rawLogHours, notify_failures: c.notifyFailures, update_check: c.updateCheck },
      ...(update ? { update } : {}),
    };
  };

  const control = {
    status,
    async doctor() {
      const { doctor } = await import("./doctor.js");
      return doctor(p);
    },
    async updateSettings(patch: Partial<AppSettings>) {
      const c = readConfig(p);
      if (patch.autostart !== undefined && patch.autostart !== serviceState().installed) {
        if (patch.autostart) {
          const s = installService(p);
          if (!s.supported) throw new Error(`start at login is not available here: ${s.reason ?? "unsupported system"}`);
        } else removeService();
        d.log(`settings: start at login ${patch.autostart ? "on" : "off"}`);
      }
      let restart = false;
      if (patch.raw_log_hours !== undefined && patch.raw_log_hours !== c.rawLogHours) {
        c.rawLogHours = patch.raw_log_hours;
        restart = true;
      }
      if (patch.notify_failures !== undefined) c.notifyFailures = patch.notify_failures;
      if (patch.update_check !== undefined && patch.update_check !== c.updateCheck) {
        c.updateCheck = patch.update_check;
        if (c.updateCheck) control.startUpdateChecks();
        else control.stopUpdateChecks();
      }
      writeConfig(p, c);
      if (restart && !d.recorder.paused()) d.recorder.restart();
      void settings;
      return status();
    },
    async setPaused(paused: boolean) {
      if (paused && !d.recorder.paused()) d.recorder.pause();
      if (!paused && d.recorder.paused()) d.recorder.resume();
      return status();
    },
    async runSetup() {
      installHook(p);
      const c = readConfig(p);
      if (!existsSync(join(p.claudeSettings, ".."))) return { summary: "Claude Code was not found on this computer. Install it, then run setup again." };
      const foreign = foreignTelemetry(readSettingsEnv(p.claudeSettings));
      c.telemetry = foreign === undefined;
      writeConfig(p, c);
      const r = configureClaudeCode({ captureDir: p.captures, otlpPort: c.otlpPort, settingsPath: p.claudeSettings, script: p.hook, telemetry: c.telemetry, otlpKey: loadOrCreateToken(p.otlpKey) });
      d.log(`setup from the review app: ${describeConfigure(r)}`);
      return { summary: r.changed || r.created ? "Claude Code is set up again. Restart any Claude Code session that is open." : "Claude Code was already set up. Nothing needed changing." };
    },
    async deleteAll() {
      const wasPaused = d.recorder.paused();
      if (!wasPaused) d.recorder.pause();
      const deleted = store.deleteAll();
      // The raw logs too, so nothing is rebuilt from them.
      rmSync(sessionsDir(p.captures), { recursive: true, force: true });
      rmSync(spoolDir(p.captures), { recursive: true, force: true });
      for (const f of [INBOX_FILE, INBOX_FILE + ROTATING_SUFFIX, ROUTER_STATE_FILE]) rmSync(join(p.captures, f), { force: true });
      for (const f of existsSync(p.captures) ? readdirSync(p.captures) : []) if (f.startsWith("otlp-") || f.startsWith(INBOX_FILE)) rmSync(join(p.captures, f), { force: true });
      d.log(`deleted everything from the review app: ${deleted} session(s)`);
      if (!wasPaused) d.recorder.resume();
      return { deleted };
    },
    async account() {
      const a = readAccount(p.home);
      // Signed in: the server that sign-in belongs to, which is where share() uploads.
      return { signed_in: !!a, server: a?.server ?? shareServer(process.env), ...(a?.email ? { email: a.email } : {}), ...(pendingLogin ? { connecting: true } : {}) };
    },
    async connect() {
      // The same flow as postrun login: this process listens on 127.0.0.1 for the browser's answer.
      pendingLogin?.close();
      const server = shareServer(process.env, readAccount(p.home));
      const login = await startBrowserLogin(server, { userAgent: UA });
      pendingLogin = login;
      login.token.then(
        async (token) => {
          const previous = readAccount(p.home);
          const me = await whoAmI(server, token, UA);
          writeAccount(p.home, { server, token, email: me.email, saved_at: new Date().toISOString() });
          if (previous && previous.token !== token) await revokeOnServer(previous.server, previous.token, UA);
          d.log(`signed in to ${server} as ${me.email} from the review app`);
        },
        (e: unknown) => d.log(`sign-in from the review app did not finish: ${(e as Error).message}`),
      ).finally(() => {
        if (pendingLogin === login) pendingLogin = undefined;
      });
      return { url: login.url };
    },
    async disconnect() {
      const a = readAccount(p.home);
      if (a) {
        await revokeOnServer(a.server, a.token, UA);
        forgetAccount(p.home);
        d.log(`signed out of ${a.server} from the review app`);
      }
      return { signed_in: false, server: shareServer(process.env) };
    },
    async feedback(payload: FeedbackPayload) {
      const a = readAccount(p.home);
      await sendFeedback(a?.server ?? shareServer(process.env), a?.token, { ...payload }, UA);
      d.log("sent feedback to Postrun");
    },
    async share(html: string, days: number) {
      const a = readAccount(p.home);
      if (!a) throw new ShareFailed("This computer isn't signed in to Postrun. Run postrun login in a terminal, then try again.", "not_signed_in");
      const r = await uploadReport(a.server, a.token, html, days, `postrun/${VERSION} (${process.platform}; review app)`);
      d.log(`shared a report: ${r.url.replace(/\/s\/.*/, "/s/…")} (expires ${r.expires_at})`);
      return { url: r.url, title: r.title, expires_at: r.expires_at };
    },
    startUpdateChecks() {
      if (timer) return;
      void checkUpdate();
      timer = setInterval(() => void checkUpdate(), 24 * 3600_000);
      timer.unref();
    },
    stopUpdateChecks() {
      if (timer) clearInterval(timer);
      timer = undefined;
      update = undefined;
    },
    /** After a session is written: notify once per streak when its last 3 steps all failed. */
    onFailures(sessionId: string) {
      if (!readConfig(p).notifyFailures) return;
      const last = store.lastSteps(sessionId, 3);
      if (last.length < 3 || !last.every((s) => s.outcome === "failed")) return;
      const seq = last[0]!.seq;
      const prev = notified.get(sessionId);
      if (prev !== undefined && seq - prev < 3) return;
      notified.set(sessionId, seq);
      const title = store.getSessionShell(sessionId)?.summary.title?.split("\n")[0]?.slice(0, 80) ?? sessionId;
      notify("Postrun: 3 failures in a row", `${title}. Open the review app to see what went wrong.`);
      d.log(`notified: 3 failures in a row in ${sessionId}`);
    },
  };
  return control;
}
