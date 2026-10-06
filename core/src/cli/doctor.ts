/**
 * `postrun doctor`: every check an interviewee could need, each with one fix.
 * Read-only: it never changes anything.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { INBOX_FILE, sessionsDir, spoolDir } from "../capture/layout.js";
import { foreignTelemetry, isClaudeCodeConfigured, readSettingsEnv } from "../capture/setup.js";
import { LOCALHOST } from "../server/server.js";
import { PostrunStore } from "../store/store.js";
import { bundledHookScript, VERSION } from "./assets.js";
import { status } from "./daemon.js";
import { readConfig, type Paths } from "./paths.js";
import { serviceState } from "./service.js";

export type Level = "ok" | "info" | "warn" | "fail";
export interface Check {
  level: Level;
  title: string;
  detail?: string;
  fix?: string;
}

export const MIN_NODE = [22, 13] as const;

export function nodeOk(version = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, LOCALHOST, () => s.close(() => resolve(true)));
  });
}

function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Newest Claude Code capture activity: the inbox or any session folder. */
function lastClaudeCodeEvent(p: Paths): number | undefined {
  const times: number[] = [];
  const inbox = join(p.captures, INBOX_FILE);
  if (existsSync(inbox)) times.push(statSync(inbox).mtimeMs);
  const spool = spoolDir(p.captures);
  if (existsSync(spool)) times.push(statSync(spool).mtimeMs);
  const dir = sessionsDir(p.captures);
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      try {
        times.push(statSync(join(dir, name)).mtimeMs);
      } catch {
        // removed meanwhile
      }
    }
  }
  return times.length > 0 ? Math.max(...times) : undefined;
}

function folderBytes(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      try {
        if (e.isDirectory()) walk(f);
        else total += statSync(f).size;
      } catch {
        // ignore
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return total;
}

const mb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export async function doctor(p: Paths): Promise<Check[]> {
  const checks: Check[] = [];
  const config = readConfig(p);

  checks.push(
    nodeOk()
      ? { level: "ok", title: `Node ${process.versions.node}` }
      : { level: "fail", title: `Node ${process.versions.node} is too old`, fix: `Install Node ${MIN_NODE.join(".")} or newer (https://nodejs.org), then run: postrun setup` },
  );

  // The folder and its permissions.
  if (!existsSync(p.home)) {
    checks.push({ level: "fail", title: `${p.home} does not exist`, fix: "postrun setup" });
  } else {
    const mode = statSync(p.home).mode & 0o777;
    checks.push(
      mode & 0o077
        ? { level: "warn", title: `${p.home} can be read by other users (mode ${mode.toString(8)})`, fix: `chmod 700 ${p.home}` }
        : { level: "ok", title: `Data folder ${p.home} (owner only, ${mb(folderBytes(p.home))})` },
    );
  }

  // The background process.
  const s = await status(p);
  if (s.running && s.health) {
    const extra = s.health.catching_up ? ", catching up on missed sessions" : "";
    const ver = s.health.version && s.health.version !== VERSION ? ` running ${s.health.version}, installed ${VERSION}` : "";
    checks.push({ level: ver ? "warn" : "ok", title: `Recording, review app on ${s.url} (pid ${s.pid}${extra})`, ...(ver ? { detail: ver.trim(), fix: "postrun restart" } : {}) });
  } else if (s.running) {
    checks.push({ level: "fail", title: `Process ${s.pid} is running but the review app does not answer on port ${s.port}`, fix: "postrun restart, then postrun doctor again" });
  } else {
    const free = await portFree(config.port);
    checks.push({
      level: "fail",
      title: "Postrun is not running, so nothing is being recorded",
      ...(free ? { fix: "postrun start" } : { detail: `Port ${config.port} is used by another program.`, fix: `postrun setup --port ${config.port + 1}` }),
    });
  }

  // Claude Code.
  const claudeDir = join(p.claudeSettings, "..");
  if (!existsSync(claudeDir)) {
    checks.push({ level: "info", title: "Claude Code not found", detail: `No ${claudeDir}.`, fix: "If you use Claude Code, run it once, then run: postrun setup" });
  } else {
    if (!existsSync(p.hook)) {
      checks.push({ level: "fail", title: "The Claude Code hook script is missing", detail: p.hook, fix: "postrun setup" });
    } else {
      let same = false;
      try {
        same = readFileSync(p.hook, "utf8") === readFileSync(bundledHookScript(), "utf8");
      } catch {
        same = false;
      }
      const exec = (statSync(p.hook).mode & 0o100) !== 0;
      if (!exec) checks.push({ level: "fail", title: "The hook script is not executable", detail: p.hook, fix: "postrun setup" });
      else if (!same) checks.push({ level: "warn", title: "The hook script is from another Postrun version", fix: "postrun setup" });
    }
    const configured = isClaudeCodeConfigured({ captureDir: p.captures, otlpPort: config.otlpPort, settingsPath: p.claudeSettings, script: p.hook, telemetry: config.telemetry });
    checks.push(
      configured
        ? { level: "ok", title: `Claude Code is set up (${p.claudeSettings})` }
        : { level: "fail", title: "Claude Code is not set up for Postrun, or its settings changed", detail: p.claudeSettings, fix: "postrun setup" },
    );
    if (!config.telemetry) {
      const foreign = foreignTelemetry(readSettingsEnv(p.claudeSettings));
      checks.push({
        level: "info",
        title: "Recording from hooks only: cost and token counts are not shown",
        detail: foreign ? `Your Claude Code telemetry already goes elsewhere (${foreign}), and Postrun leaves it alone.` : "Telemetry is off for Postrun.",
      });
    } else if (s.health?.telemetry && s.health.telemetry !== "running" && s.health.telemetry !== "starting") {
      checks.push({
        level: "warn",
        title: `Telemetry receiver not running (${s.health.telemetry}): cost and token counts are missing`,
        detail: "Prompts, commands, edits and replies are still recorded from hooks.",
        fix: `Free port ${config.otlpPort}, or run: postrun setup (picks a free port), then restart Claude Code`,
      });
    }
    const last = lastClaudeCodeEvent(p);
    checks.push(
      last === undefined
        ? { level: "warn", title: "No Claude Code activity recorded yet", fix: "Restart Claude Code (it reads its settings only when it starts) and send it a prompt" }
        : { level: "ok", title: `Last Claude Code activity ${ago(Date.now() - last)}` },
    );
  }

  // Cline.
  checks.push(
    existsSync(p.clineSessions)
      ? { level: "ok", title: `Cline found (${p.clineSessions})` }
      : { level: "info", title: "Cline not found", detail: "If you install Cline later, its sessions are recorded automatically." },
  );

  // The store.
  if (existsSync(p.db)) {
    try {
      const store = new PostrunStore({ path: p.db });
      const c = store.counts();
      store.close();
      checks.push({ level: "ok", title: `${c.sessions} session(s) stored, ${c.steps} steps` });
    } catch (err) {
      checks.push({ level: "fail", title: "Cannot open the session store", detail: `${p.db}: ${(err as Error).message}`, fix: "Send this output to the Postrun team" });
    }
  }

  // Start at login.
  const svc = serviceState();
  if (!svc.supported) {
    checks.push({ level: "info", title: "Start at login not available", ...(svc.reason ? { detail: svc.reason } : {}), fix: "Run postrun start after you log in" });
  } else if (!svc.installed) {
    checks.push({ level: "info", title: "Postrun does not start at login", fix: "postrun autostart on" });
  } else {
    const missing = (svc.command ?? []).slice(0, 1).concat((svc.command ?? []).slice(-2, -1)).filter((f) => !existsSync(f));
    checks.push(
      missing.length > 0
        ? { level: "warn", title: "Start at login points at a Node or Postrun that no longer exists", detail: missing.join(", "), fix: "postrun autostart on" }
        : { level: "ok", title: "Starts at login" },
    );
  }
  return checks;
}

const LABEL: Record<Level, string> = { ok: "ok  ", info: "info", warn: "warn", fail: "FAIL" };

export function formatChecks(checks: Check[]): string {
  const lines: string[] = [];
  for (const c of checks) {
    lines.push(`  ${LABEL[c.level]}  ${c.title}`);
    if (c.detail) lines.push(`        ${c.detail}`);
    if (c.fix && c.level !== "ok") lines.push(`        Fix: ${c.fix}`);
  }
  return lines.join("\n");
}
