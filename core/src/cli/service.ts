/**
 * Start at login: a launchd agent on macOS, a systemd user service on Linux.
 *
 * Both run `postrun run`. If Postrun is already running (started by hand), the
 * copy started at login sees it and exits quietly. A clean stop (`postrun
 * stop`) exits 0, which neither restarts; a crash is restarted after a minute.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { Paths } from "./paths.js";

export const LAUNCHD_LABEL = "app.postrun.recorder";
export const SYSTEMD_UNIT = "postrun.service";

export interface ServiceState {
  supported: boolean;
  kind: "launchd" | "systemd" | "none";
  installed: boolean;
  file?: string;
  /** The command the service runs, when installed. */
  command?: string[];
  /** Why start at login is not available here. */
  reason?: string;
}

function userHome(): string {
  return process.env["HOME"] ?? homedir();
}

function launchdFile(): string {
  return join(userHome(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

function systemdFile(): string {
  const base = process.env["XDG_CONFIG_HOME"] ?? join(userHome(), ".config");
  return join(base, "systemd", "user", SYSTEMD_UNIT);
}

function hasSystemdUser(): boolean {
  const r = spawnSync("systemctl", ["--user", "show-environment"], { stdio: "ignore", timeout: 5000 });
  return r.status === 0;
}

/**
 * This Node, by the name it has on the PATH when that is the same binary.
 * process.execPath is fully resolved, which for Homebrew is a versioned Cellar
 * path that disappears on the next `brew upgrade`; /opt/homebrew/bin/node stays.
 */
function stableNode(): string {
  const real = realpathSync(process.execPath);
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "node");
    try {
      if (realpathSync(candidate) === real) return candidate;
    } catch {
      // not here
    }
  }
  return process.execPath;
}

/** The command a service should run: this Node and this entry script. */
export function serviceCommand(): string[] {
  const entry = process.argv[1];
  if (!entry) throw new Error("cannot find the postrun entry script");
  return [stableNode(), ...process.execArgv, realpathSync(entry), "run"];
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function plist(cmd: string[], p: Paths): string {
  const env = process.env["POSTRUN_HOME"] ? `  <key>EnvironmentVariables</key>\n  <dict>\n    <key>POSTRUN_HOME</key><string>${xml(p.home)}</string>\n  </dict>\n` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${cmd.map((c) => `    <string>${xml(c)}</string>`).join("\n")}
  </array>
${env}  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>${xml(p.log)}</string>
</dict>
</plist>
`;
}

/**
 * Quote one value for a systemd unit. systemd expands %-specifiers everywhere and $VARIABLES in
 * ExecStart, so a path holding % or $ is doubled to stay literal; a newline cannot be written at all.
 */
const quote = (s: string, dollars = true) => {
  if (/[\r\n]/.test(s)) throw new Error(`cannot write a path with a line break into a systemd unit: ${JSON.stringify(s)}`);
  let v = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%");
  if (dollars) v = v.replace(/\$/g, "$$$$");
  return `"${v}"`;
};

export function unit(cmd: string[], p: Paths): string {
  const env = process.env["POSTRUN_HOME"] ? `Environment=${quote(`POSTRUN_HOME=${p.home}`, false)}\n` : "";
  return `[Unit]
Description=Postrun, the flight recorder for coding agents

[Service]
ExecStart=${cmd.map((c) => quote(c)).join(" ")}
${env}Restart=on-failure
RestartSec=60

[Install]
WantedBy=default.target
`;
}

export function parseCommand(kind: "launchd" | "systemd", text: string): string[] {
  if (kind === "launchd") {
    const arr = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1] ?? "";
    return [...arr.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  }
  const line = /^ExecStart=(.*)$/m.exec(text)?.[1] ?? "";
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\(.)/g, "$1").replace(/%%/g, "%").replace(/\$\$/g, "$"));
}

export function serviceState(): ServiceState {
  if (process.platform === "darwin") {
    const file = launchdFile();
    if (!existsSync(file)) return { supported: true, kind: "launchd", installed: false, file };
    return { supported: true, kind: "launchd", installed: true, file, command: parseCommand("launchd", readFileSync(file, "utf8")) };
  }
  if (process.platform === "linux") {
    const file = systemdFile();
    if (existsSync(file)) return { supported: true, kind: "systemd", installed: true, file, command: parseCommand("systemd", readFileSync(file, "utf8")) };
    if (!hasSystemdUser()) return { supported: false, kind: "none", installed: false, reason: "this system has no systemd user session" };
    return { supported: true, kind: "systemd", installed: false, file };
  }
  return { supported: false, kind: "none", installed: false, reason: `start at login is not supported on ${process.platform} yet` };
}

function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 15_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/** Install (or refresh) start at login. Does not start a second copy now: `postrun start` does that. */
export function installService(p: Paths): ServiceState {
  const state = serviceState();
  if (!state.supported || !state.file) return state;
  const cmd = serviceCommand();
  mkdirSync(dirname(state.file), { recursive: true });
  if (state.kind === "launchd") {
    const uid = String(process.getuid?.() ?? "");
    if (state.installed) run("launchctl", ["bootout", `gui/${uid}/${LAUNCHD_LABEL}`]);
    writeFileSync(state.file, plist(cmd, p), { mode: 0o644 });
    // Loading it runs it once now; if Postrun is already running that copy exits at once.
    const r = run("launchctl", ["bootstrap", `gui/${uid}`, state.file]);
    if (!r.ok && !/already|in progress/i.test(r.out)) throw new Error(`launchctl bootstrap failed: ${r.out}`);
  } else {
    writeFileSync(state.file, unit(cmd, p), { mode: 0o644 });
    run("systemctl", ["--user", "daemon-reload"]);
    const r = run("systemctl", ["--user", "enable", SYSTEMD_UNIT]);
    if (!r.ok) throw new Error(`systemctl --user enable failed: ${r.out}`);
  }
  return { ...serviceState() };
}

export function removeService(): ServiceState {
  const state = serviceState();
  if (!state.installed || !state.file) return state;
  if (state.kind === "launchd") {
    run("launchctl", ["bootout", `gui/${String(process.getuid?.() ?? "")}/${LAUNCHD_LABEL}`]);
  } else {
    run("systemctl", ["--user", "disable", SYSTEMD_UNIT]);
  }
  rmSync(state.file, { force: true });
  if (state.kind === "systemd") run("systemctl", ["--user", "daemon-reload"]);
  return serviceState();
}
