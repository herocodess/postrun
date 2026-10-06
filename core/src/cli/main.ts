/**
 * The `postrun` command.
 *
 *   postrun setup        set up Claude Code, start recording, open the review app
 *   postrun start | stop | restart | status
 *   postrun open         open the review app in your browser
 *   postrun sessions     list recorded sessions
 *   postrun export <id>  write a redacted HTML report
 *   postrun delete <id>  delete one session for good
 *   postrun doctor       check everything, with a fix for each problem
 *   postrun autostart on|off
 *   postrun uninstall    take Postrun out of Claude Code, stop it, optionally delete its data
 *   postrun run          the background process itself (used by start and start at login)
 */

import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { sessionDir } from "../capture/layout.js";
import { configureClaudeCode, foreignTelemetry, readSettingsEnv, unconfigureClaudeCode } from "../capture/setup.js";
import { exportSession } from "../export/index.js";
import { PostrunStore } from "../store/store.js";
import { ensurePrivateDir, PRIVATE_DIR_MODE } from "../util/files.js";
import { VERSION } from "./assets.js";
import { installHook } from "./hook.js";
import { loadOrCreateToken } from "../server/token.js";
import { readPid, run, start, status, stop } from "./daemon.js";
import { doctor, formatChecks, portFree } from "./doctor.js";
import { paths, readConfig, writeConfig, type Paths } from "./paths.js";
import { installService, removeService, serviceState } from "./service.js";

const out = (s = "") => process.stdout.write(s + "\n");
const err = (s: string) => process.stderr.write(s + "\n");

class UsageError extends Error {}

interface Args {
  positional: string[];
  flags: Map<string, string | true>;
}

function parse(argv: string[], valueFlags: string[] = []): Args {
  const a: Args = { positional: [], flags: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (x.startsWith("--")) {
      const eq = x.indexOf("=");
      const name = eq > 0 ? x.slice(2, eq) : x.slice(2);
      if (eq > 0) a.flags.set(name, x.slice(eq + 1));
      else if (valueFlags.includes(name)) {
        const v = argv[++i];
        if (v === undefined) throw new UsageError(`--${name} needs a value`);
        a.flags.set(name, v);
      } else a.flags.set(name, true);
    } else if (x === "-y") a.flags.set("yes", true);
    else if (x === "-o") {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`-o needs a file name`);
      a.flags.set("out", v);
    } else if (x === "-h") a.flags.set("help", true);
    else if (x.startsWith("-")) throw new UsageError(`unknown option ${x}`);
    else a.positional.push(x);
  }
  return a;
}

function onlyFlags(a: Args, allowed: string[]): void {
  for (const k of a.flags.keys()) if (!allowed.includes(k) && k !== "help") throw new UsageError(`unknown option --${k}`);
}

const interactive = () => process.stdin.isTTY === true && process.stdout.isTTY === true;

async function ask(question: string, defaultYes: boolean): Promise<boolean> {
  if (!interactive()) return defaultYes;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
    return a === "" ? defaultYes : a === "y" || a === "yes";
  } finally {
    rl.close();
  }
}

/**
 * The review app's address with this computer's key in the fragment. A fragment never reaches a
 * server or its logs; the app keeps the key in this browser and removes it from the address bar.
 */
function appLink(p: Paths, url: string): string {
  return `${url}#key=${loadOrCreateToken(p.token)}`;
}

/**
 * Open the review app with its key without putting the key on a command line, where other
 * accounts could read it with ps: the browser opens a private file (in ~/.postrun, owner only)
 * that forwards to the keyed address.
 */
function openApp(p: Paths, url: string): boolean {
  const link = appLink(p, url);
  const file = join(p.home, "open.html");
  try {
    ensurePrivateDir(p.home);
    const attr = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    writeFileSync(
      file,
      `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${attr}"><title>Postrun</title><script>location.replace(${JSON.stringify(link)})</script><a href="${attr}">Open Postrun</a>\n`,
      { mode: 0o600 },
    );
    chmodSync(file, 0o600);
  } catch {
    return false;
  }
  return openBrowser(file);
}

function openBrowser(url: string): boolean {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : undefined;
  if (!cmd) return false;
  try {
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function firstFreePort(from: number, tries = 20): Promise<number | undefined> {
  for (let port = from; port < from + tries && port <= 65535; port++) if (await portFree(port)) return port;
  return undefined;
}

async function cmdSetup(argv: string[]): Promise<number> {
  const a = parse(argv, ["port"]);
  onlyFlags(a, ["autostart", "no-autostart", "no-open", "yes", "port"]);
  if (a.flags.has("help")) return help("setup");
  const p = paths();
  out(`Setting up Postrun ${VERSION}`);
  out();

  const config = readConfig(p);
  const running = await status(p);
  const portFlag = a.flags.get("port");
  if (typeof portFlag === "string") {
    const n = Number(portFlag);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new UsageError(`--port must be a number between 1 and 65535`);
    config.port = n;
  }
  // Ports: keep what works; move off a port another program holds.
  const ownsPorts = running.running && running.health !== undefined;
  if (!ownsPorts || running.port !== config.port) {
    if (!(await portFree(config.port))) {
      if (typeof portFlag === "string") {
        err(`Port ${config.port} is in use by another program. Pick another with --port.`);
        return 1;
      }
      const free = await firstFreePort(config.port + 1);
      if (!free) throw new Error(`port ${config.port} and the next 20 are in use; pick one with --port`);
      out(`  Port ${config.port} is in use by another program, so the review app uses ${free}.`);
      config.port = free;
    }
  }
  const otlpOwned = ownsPorts && readPid(p)?.otlpPort === config.otlpPort;
  if (!otlpOwned && !(await portFree(config.otlpPort))) {
    const free = await firstFreePort(config.otlpPort + 1);
    if (free) {
      out(`  Port ${config.otlpPort} is in use by another program, so Claude Code telemetry goes to ${free}.`);
      config.otlpPort = free;
    }
  }

  ensurePrivateDir(p.home);
  installHook(p);

  // Claude Code.
  const hasClaude = existsSync(resolve(p.claudeSettings, ".."));
  if (hasClaude) {
    const foreign = foreignTelemetry(readSettingsEnv(p.claudeSettings));
    config.telemetry = foreign === undefined;
    const r = configureClaudeCode({ captureDir: p.captures, otlpPort: config.otlpPort, settingsPath: p.claudeSettings, script: p.hook, telemetry: config.telemetry, otlpKey: loadOrCreateToken(p.otlpKey) });
    out(`  Claude Code: ${r.changed || r.created ? "set up" : "already set up"} (${p.claudeSettings})`);
    if (r.backed_up) out(`    Your original settings are saved in ${r.backup_path}`);
    if (foreign) {
      out(`    Your Claude Code telemetry already goes to ${foreign}. Postrun leaves that alone`);
      out(`    and records from hooks only: everything is recorded except cost and token counts.`);
    }
  } else {
    out(`  Claude Code: not found. If you install it later, run postrun setup again.`);
  }
  out(`  Cline: ${existsSync(p.clineSessions) ? "found, recorded automatically" : "not found. If you install it later, it is recorded automatically."}`);
  writeConfig(p, config);

  // Start, or restart when a different version or different ports are running.
  const pid = readPid(p);
  const stale = running.running && (running.health?.version !== VERSION || pid?.port !== config.port || pid?.otlpPort !== config.otlpPort);
  if (stale) await stop(p);
  const s = await start(p);
  if (!s.started && !s.already) {
    err(`\nPostrun could not start. The last lines of ${p.log}:\n${s.error ?? ""}\n\nRun postrun doctor for details.`);
    return 1;
  }
  out(`  Recording: ${s.already ? "already running" : stale ? "restarted" : "started"} in the background`);

  // Start at login.
  const svc = serviceState();
  if (!svc.supported) {
    out(`  Start at login: not available (${svc.reason ?? "unsupported"}). Run postrun start after you log in.`);
  } else {
    const want = a.flags.has("no-autostart") ? false : a.flags.has("autostart") || a.flags.has("yes") ? true : await ask("\n  Start Postrun automatically when you log in?", true);
    try {
      if (want) {
        installService(p);
        out(`  Start at login: on`);
      } else {
        removeService();
        out(`  Start at login: off. Run postrun start after you log in.`);
      }
    } catch (e) {
      out(`  Start at login: could not be turned on (${(e as Error).message}). Run postrun start after you log in.`);
    }
  }

  const url = s.status.url;
  out();
  out(`Postrun is recording. Review your sessions at ${url}`);
  if (hasClaude) out(`Restart any Claude Code session that is already open, so it is recorded too.`);
  out(`Check on it any time with postrun status, or postrun doctor if something looks wrong.`);
  if (!a.flags.has("no-open") && interactive()) openApp(p, url);
  return 0;
}

async function cmdStart(): Promise<number> {
  const p = paths();
  const r = await start(p);
  if (r.already) out(`Postrun is already running: ${r.status.url}`);
  else if (r.started) out(`Postrun is recording: ${r.status.url}`);
  else {
    err(`Postrun could not start. The last lines of ${p.log}:\n${r.error ?? ""}\n\nRun postrun doctor for details.`);
    return 1;
  }
  return 0;
}

async function cmdStop(): Promise<number> {
  const stopped = await stop(paths());
  out(stopped ? "Postrun stopped. Claude Code sessions are still saved to disk, and are added (without cost data) when you run postrun start. To stop recording altogether, pause it in Settings." : "Postrun was not running.");
  return 0;
}

async function cmdStatus(): Promise<number> {
  const p = paths();
  const s = await status(p);
  if (!s.running) {
    out("Postrun is not running, so nothing is being recorded. Start it with: postrun start");
    return 3;
  }
  if (!s.health) {
    out(`Postrun (pid ${s.pid}) is running but not answering on port ${s.port}. Try: postrun restart`);
    return 1;
  }
  const store = existsSync(p.db) ? new PostrunStore({ path: p.db }) : undefined;
  const c = store?.counts();
  store?.close();
  out(`Postrun ${s.health.version ?? ""} is recording (pid ${s.pid}).`);
  out(`Review app: ${s.url}`);
  if (c) out(`Stored: ${c.sessions} session(s), ${c.steps} steps`);
  if (s.health.telemetry && s.health.telemetry !== "running") out(`Telemetry: ${s.health.telemetry}`);
  if (s.health.catching_up) out(`Catching up on sessions recorded while it was stopped.`);
  return 0;
}

async function cmdOpen(): Promise<number> {
  const p = paths();
  const s = await status(p);
  if (!s.running) {
    err("Postrun is not running. Start it with: postrun start");
    return 1;
  }
  // The link carries this computer's key, so this browser is connected from now on.
  if (!openApp(p, s.url)) out(`Open this link in your browser (it connects the browser to Postrun):\n${appLink(p, s.url)}`);
  else out(s.url);
  return 0;
}

function withStore<T>(p: Paths, fn: (store: PostrunStore) => T): T {
  const store = new PostrunStore({ path: p.db });
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

function cmdSessions(argv: string[]): number {
  const a = parse(argv, ["agent"]);
  onlyFlags(a, ["agent"]);
  const agent = a.flags.get("agent");
  const p = paths();
  if (!existsSync(p.db)) {
    out("No sessions recorded yet.");
    return 0;
  }
  return withStore(p, (store) => {
    const rows = store.listSessions(typeof agent === "string" ? { agent } : {});
    if (rows.length === 0) {
      out("No sessions recorded yet.");
      return 0;
    }
    for (const s of rows) {
      const title = s.title ? s.title.split("\n")[0]!.slice(0, 90) : "(no prompt)";
      out(`${s.started_at.slice(0, 16).replace("T", " ")}  ${s.agent.kind.padEnd(11)} ${s.id}`);
      out(`    ${title}`);
      out(`    ${s.steps_total} steps, ${s.turn_count} turns${s.failed_count ? `, ${s.failed_count} failed` : ""}${s.metrics.cost_usd ? `, $${s.metrics.cost_usd.toFixed(2)}` : ""}  ${s.workspace.root}`);
    }
    return 0;
  });
}

function cmdExport(argv: string[]): number {
  const a = parse(argv, ["out"]);
  onlyFlags(a, ["out", "force"]);
  const id = a.positional[0];
  if (!id) throw new UsageError("export needs a session id (see postrun sessions)");
  const p = paths();
  return withStore(p, (store) => {
    const session = store.getSession(id);
    if (!session) {
      err(`No session ${id}. List them with: postrun sessions`);
      return 1;
    }
    const result = exportSession(session);
    const o = a.flags.get("out");
    const path = resolve(typeof o === "string" ? o : result.filename);
    if (existsSync(path) && !a.flags.has("force")) {
      err(`${path} exists; add --force to overwrite it`);
      return 1;
    }
    writeFileSync(path, result.html, { mode: 0o600 });
    const { findings, home_paths } = result.redaction;
    out(`Wrote ${path} (${session.steps.length} steps)`);
    if (findings.length === 0) out(`Redaction: no secrets found${home_paths ? `; ${home_paths} home path(s) shown as ~` : ""}`);
    else {
      out(`Redaction: masked ${findings.length} value(s)${home_paths ? ` and ${home_paths} home path(s)` : ""}. Check them before sharing:`);
      for (const f of findings) out(`  ${f.kind.padEnd(15)} ${f.location}\n      ${f.context}`);
    }
    out("Redaction is automatic, not a guarantee. Skim the report before you send it.");
    return 0;
  });
}

function cmdDelete(argv: string[]): number {
  const a = parse(argv);
  onlyFlags(a, ["yes"]);
  const id = a.positional[0];
  if (!id) throw new UsageError("delete needs a session id (see postrun sessions)");
  const p = paths();
  return withStore(p, (store) => {
    const s = store.getSessionShell(id);
    if (!s) {
      err(store.isDeleted(id) ? `Session ${id} was already deleted.` : `No session ${id}. List them with: postrun sessions`);
      return 1;
    }
    const raw = sessionDir(p.captures, id);
    if (!a.flags.has("yes")) {
      out(`This deletes ${s.summary.agent.kind} session ${id}${s.summary.title ? ` ("${s.summary.title.split("\n")[0]!.slice(0, 60)}")` : ""}:`);
      out(`${s.summary.steps_total} steps${existsSync(raw) ? ", and its raw files" : ""}. It cannot be undone.`);
      out(`Run again with --yes to delete it.`);
      return 0;
    }
    store.deleteSession(id);
    rmSync(raw, { recursive: true, force: true });
    out(`Deleted session ${id}. Postrun will not record it again.`);
    out(
      s.summary.agent.kind === "cline"
        ? "Cline keeps its own copy in ~/.cline/data/sessions; delete the task in Cline if you want it gone there too."
        : "Claude Code keeps its own transcript under ~/.claude/projects; delete it there if you want it gone too.",
    );
    return 0;
  });
}

async function cmdDoctor(): Promise<number> {
  const p = paths();
  out(`postrun doctor (Postrun ${VERSION}, ${process.platform} ${process.arch})`);
  out();
  const checks = await doctor(p);
  out(formatChecks(checks));
  out();
  const fails = checks.filter((c) => c.level === "fail").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  out(fails + warns === 0 ? "Everything looks good." : `${fails} problem(s), ${warns} warning(s). Each has a fix above.`);
  return fails > 0 ? 1 : 0;
}

function cmdAutostart(argv: string[]): number {
  const a = parse(argv);
  onlyFlags(a, []);
  const what = a.positional[0];
  if (what !== "on" && what !== "off") {
    const s = serviceState();
    out(!s.supported ? `Start at login is not available: ${s.reason ?? ""}` : s.installed ? "Postrun starts at login." : "Postrun does not start at login.");
    out("Change it with: postrun autostart on|off");
    return 0;
  }
  const p = paths();
  if (what === "on") {
    const s = installService(p);
    if (!s.supported) {
      err(`Start at login is not available: ${s.reason ?? ""}`);
      return 1;
    }
    out("Postrun now starts when you log in.");
  } else {
    removeService();
    out("Postrun no longer starts at login. Run postrun start when you want to record.");
  }
  return 0;
}

/**
 * A folder uninstall may delete whole: Postrun's own files are in it, and it is not the home
 * folder or the root. A mistyped POSTRUN_HOME must never take another folder with it.
 */
export function looksLikePostrunHome(dir: string, userHome = homedir()): boolean {
  const d = resolve(dir);
  if (d === resolve(userHome) || d === resolve("/") || d === dirname(resolve(userHome))) return false;
  return ["postrun.db", "config.json", "ingest-token"].some((f) => existsSync(join(d, f)));
}

async function cmdUninstall(argv: string[]): Promise<number> {
  const a = parse(argv);
  onlyFlags(a, ["yes", "delete-data", "keep-data"]);
  const p = paths();
  out("This takes Postrun out of Claude Code, stops it, and turns off start at login.");
  if (!a.flags.has("yes") && !(await ask("Continue?", true))) {
    out("Nothing changed.");
    return 0;
  }
  await stop(p);
  removeService();
  if (existsSync(p.claudeSettings)) {
    try {
      const r = unconfigureClaudeCode({ settingsPath: p.claudeSettings });
      out(r.changed ? `  Removed Postrun's hooks and settings from ${p.claudeSettings}` : `  Claude Code had no Postrun settings`);
    } catch (e) {
      err(`  Could not edit ${p.claudeSettings}: ${(e as Error).message}`);
    }
  }
  rmSync(p.bin, { recursive: true, force: true });
  out("  Stopped Postrun and turned off start at login");

  const deleteData = a.flags.has("delete-data")
    ? true
    : a.flags.has("keep-data")
      ? false
      : await ask(`Also delete everything Postrun recorded (${p.home})? This cannot be undone.`, false);
  if (deleteData && !looksLikePostrunHome(p.home)) {
    err(`  Not deleting ${p.home}: it does not look like Postrun's folder (no postrun.db, config.json or ingest-token in it). Check POSTRUN_HOME, then delete it yourself if you are sure.`);
  } else if (deleteData) {
    rmSync(p.home, { recursive: true, force: true });
    out(`  Deleted ${p.home}`);
  } else {
    out(`  Kept your recorded sessions in ${p.home}. Delete that folder whenever you like.`);
  }
  out();
  out("Restart any open Claude Code session so it stops calling Postrun's hook.");
  out("To remove the postrun command itself: npm uninstall -g postrun");
  return 0;
}

const HELP: Record<string, string> = {
  main: `postrun ${VERSION}: the flight recorder for coding agents

Usage: postrun <command>

Getting started
  setup                Set up Claude Code, start recording, open the review app

Everyday
  status               Is it recording, and where is the review app
  open                 Open the review app in your browser
  sessions             List recorded sessions
  export <id>          Write a redacted HTML report of one session
  delete <id>          Delete one session for good

Running
  start | stop | restart
  autostart on|off     Start Postrun when you log in

Help
  doctor               Check everything, with a fix for each problem
  uninstall            Take Postrun out of Claude Code and stop it
  version

Your sessions stay on this computer, in ~/.postrun. Docs: https://docs.postrun.app`,
  setup: `Usage: postrun setup [--port <n>] [--autostart | --no-autostart] [--no-open] [--yes]

Sets up Claude Code to be recorded, starts Postrun in the background and
opens the review app. Safe to run again at any time, for example after
updating Postrun or installing Claude Code.

  --port <n>        Port for the review app (default 1234)
  --autostart       Start at login without asking
  --no-autostart    Do not start at login
  --no-open         Do not open the browser
  --yes             Accept the defaults without asking`,
};

function help(topic = "main"): number {
  out(HELP[topic] ?? HELP["main"]!);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        return help(rest[0]);
      case "version":
      case "--version":
      case "-v":
        out(VERSION);
        return 0;
      case "setup":
        return await cmdSetup(rest);
      case "start":
        return await cmdStart();
      case "stop":
        return await cmdStop();
      case "restart":
        await stop(paths());
        return await cmdStart();
      case "status":
        return await cmdStatus();
      case "open":
        return await cmdOpen();
      case "sessions":
      case "ls":
        return cmdSessions(rest);
      case "export":
        return cmdExport(rest);
      case "delete":
        return cmdDelete(rest);
      case "doctor":
        return await cmdDoctor();
      case "autostart":
        return cmdAutostart(rest);
      case "uninstall":
        return await cmdUninstall(rest);
      case "run":
        return await run(paths());
      default:
        err(`Unknown command "${command}". Run postrun help to see them all.`);
        return 2;
    }
  } catch (e) {
    if (e instanceof UsageError) {
      err(`postrun ${command}: ${e.message}`);
      return 2;
    }
    err(`postrun ${command}: ${(e as Error).message}`);
    return 1;
  }
}
