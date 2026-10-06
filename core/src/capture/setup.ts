/**
 * Self-configuration of Claude Code for Postrun capture.
 *
 * `configureClaudeCode` merges Postrun's env vars and six hooks into
 * ~/.claude/settings.json. It backs the file up first (once, so the true
 * original is preserved), keeps every other key, env var, and hook exactly as
 * it found them, and is idempotent: Postrun's own entries are detected by the
 * hook command path and updated in place rather than appended again.
 *
 * Claude Code reads settings.json only at launch, so a session that is already
 * running keeps its old configuration until it is restarted.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_OTLP_PORT, OTLP_HOST } from "./receiver.js";

export const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PostToolUseFailure", "Stop", "SessionEnd"] as const;
export const BACKUP_SUFFIX = ".postrun-backup";

export function hookScriptPath(): string {
  // core/src/capture (tsx) or core/dist/capture (node) -> core/scripts/capture-hook.sh
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "scripts", "capture-hook.sh");
}

export function defaultSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

/** The header that carries the telemetry key, so only Claude Code (which reads it from settings) can write telemetry. */
export const OTLP_KEY_HEADER = "x-postrun-key";
const OTLP_HEADERS_KEY = "OTEL_EXPORTER_OTLP_HEADERS";

export function captureEnv(captureDir: string, otlpPort = DEFAULT_OTLP_PORT, otlpKey?: string): Record<string, string> {
  return {
    ...(otlpKey ? { [OTLP_HEADERS_KEY]: `${OTLP_KEY_HEADER}=${otlpKey}` } : {}),
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    // Logs only. Metrics and traces are never read, so Claude Code is not asked to send them
    // (that costs CPU in Claude Code and disk here for nothing). See RETIRED_ENV.
    OTEL_LOGS_EXPORTER: "otlp",
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://${OTLP_HOST}:${otlpPort}`,
    OTEL_LOG_USER_PROMPTS: "1",
    OTEL_LOG_ASSISTANT_RESPONSES: "1",
    OTEL_LOG_TOOL_DETAILS: "1",
    OTEL_LOG_TOOL_CONTENT: "1",
    // OTEL_LOG_RAW_API_BODIES is deliberately absent: it makes Claude Code write
    // every raw API request (system prompt, full conversation) to disk, and
    // Postrun never reads those files.
    OTEL_LOGS_EXPORT_INTERVAL: "2000",
    POSTRUN_CAPTURE_DIR: captureDir,
  };
}

export interface HookCommand {
  type: "command";
  command: string;
  timeout: number;
}

/** Single-quote a path for the shell Claude Code runs hook commands through. Plain paths are left bare. */
export function shellQuote(path: string): string {
  return /^[A-Za-z0-9_\/.:@%+=,-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
}

/** Inverse of shellQuote for a command that is exactly one quoted or bare path; anything else is returned as is. */
export function shellUnquote(command: string): string {
  const c = command.trim();
  if (c.length >= 2 && c.startsWith("'") && c.endsWith("'")) return c.slice(1, -1).replace(/'\\''/g, "'");
  return c;
}

export function captureHook(script = hookScriptPath()): HookCommand {
  return { type: "command", command: shellQuote(script), timeout: 10 };
}

/** The complete env + hooks block Postrun needs, as a standalone object. */
export function captureSettings(captureDir: string, otlpPort = DEFAULT_OTLP_PORT, script = hookScriptPath()): Record<string, unknown> {
  return {
    env: captureEnv(captureDir, otlpPort),
    hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [captureHook(script)] }]])),
  };
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A hook is Postrun's own when its command is the repo script, or an earlier
 * Postrun capture script (a `capture.sh` / `capture-hook.sh` under a directory
 * whose path contains "postrun"). Both append to the same hooks.ndjson, so
 * keeping two of them would record every event twice.
 */
export function isPostrunHook(hook: unknown, script = hookScriptPath()): boolean {
  if (!isObject(hook) || typeof hook["command"] !== "string") return false;
  const command = shellUnquote(hook["command"]);
  if (command === script) return true;
  const name = basename(command);
  return (name === "capture-hook.sh" || name === "capture.sh") && /postrun/i.test(dirname(command));
}

/**
 * Env keys Postrun set in the past and no longer wants. Removed only when the
 * value carries Postrun's fingerprint, so a user's own setting is never touched.
 */
const RETIRED_ENV: Array<{ key: string; ours: (value: unknown, env: Json) => boolean }> = [
  { key: "OTEL_LOG_RAW_API_BODIES", ours: (v) => typeof v === "string" && /^file:.*[\\/]\.postrun[\\/].*api-bodies$/.test(v) },
  // Metrics and traces were exported to Postrun's receiver and never read. Removed only when the
  // value is the one Postrun set AND the endpoint is Postrun's loopback receiver, so a user's own
  // OpenTelemetry setup is left alone.
  { key: "OTEL_METRICS_EXPORTER", ours: (v, env) => v === "otlp" && postrunEndpoint(env) },
  { key: "OTEL_TRACES_EXPORTER", ours: (v, env) => v === "otlp" && postrunEndpoint(env) },
  { key: "OTEL_METRIC_EXPORT_INTERVAL", ours: (v, env) => v === "10000" && postrunEndpoint(env) },
  { key: "OTEL_TRACES_EXPORT_INTERVAL", ours: (v, env) => v === "2000" && postrunEndpoint(env) },
];

/** Telemetry keys Postrun sets, other than POSTRUN_CAPTURE_DIR. */
const TELEMETRY_KEYS = Object.keys(captureEnv("", DEFAULT_OTLP_PORT, "k")).filter((k) => k !== "POSTRUN_CAPTURE_DIR");

/** The headers value is Postrun's when it is exactly its key header and nothing else. */
const ownHeaders = (v: unknown): boolean => typeof v === "string" && new RegExp(`^${OTLP_KEY_HEADER}=[A-Za-z0-9_-]+$`).test(v);

/**
 * Remove the telemetry keys Postrun set, in place. A key is Postrun's only while
 * the endpoint is Postrun's receiver and the value is the one Postrun writes;
 * a key the user had before Postrun (same value in the backup) is kept.
 */
function removeOwnTelemetry(env: Json, judgeBy: Json, before?: Json): string[] {
  if (!postrunEndpoint(judgeBy)) return [];
  const ours = captureEnv(String(judgeBy["POSTRUN_CAPTURE_DIR"]), Number(String(judgeBy["OTEL_EXPORTER_OTLP_ENDPOINT"]).split(":").pop()));
  const removed: string[] = [];
  for (const k of TELEMETRY_KEYS) {
    if (!(k in env)) continue;
    if (k === OTLP_HEADERS_KEY ? !ownHeaders(env[k]) : env[k] !== ours[k]) continue;
    if (before && k !== "OTEL_EXPORTER_OTLP_ENDPOINT" && before[k] === env[k]) continue;
    delete env[k];
    removed.push(k);
  }
  return removed;
}

/**
 * Telemetry the user already sends somewhere else. Postrun would have to
 * replace their endpoint to receive it, so setup records from hooks only
 * instead. Returns a short description, or undefined when there is none.
 */
export function foreignTelemetry(env: Json): string | undefined {
  if (postrunEndpoint(env)) return undefined;
  for (const k of ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"]) {
    const v = env[k];
    if (typeof v === "string" && v.trim() !== "") return `${k}=${v}`;
  }
  const exporter = env["OTEL_LOGS_EXPORTER"];
  if (typeof exporter === "string" && exporter !== "" && exporter !== "otlp") return `OTEL_LOGS_EXPORTER=${exporter}`;
  return undefined;
}

/** The env block of a settings file, or {} when the file or block is missing or unreadable. */
export function readSettingsEnv(path = defaultSettingsPath()): Json {
  try {
    const env = readSettings(path)?.["env"];
    return isObject(env) ? env : {};
  } catch {
    return {};
  }
}

function postrunEndpoint(env: Json): boolean {
  const e = env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  return typeof e === "string" && e.startsWith(`http://${OTLP_HOST}:`) && typeof env["POSTRUN_CAPTURE_DIR"] === "string";
}

export interface MergeReport {
  env_added: string[];
  /** Postrun keys that were present with a different value and were replaced. */
  env_changed: Array<{ key: string; from: unknown }>;
  /** Retired Postrun keys removed because their value was Postrun's own. */
  env_removed: string[];
  hooks_added: string[];
  /** Events where an existing Postrun hook was updated in place. */
  hooks_updated: string[];
  /** Duplicate Postrun hooks removed, per event, beyond the one kept. */
  hooks_deduplicated: string[];
  changed: boolean;
}

/**
 * Pure merge: returns a new settings object. Unknown keys, unrelated env vars,
 * and hooks that are not Postrun's are carried over untouched, including
 * their order. Malformed `env` or `hooks` values are left as they are and
 * reported as unmergeable by throwing.
 */
export function mergeCaptureSettings(
  existing: Json,
  captureDir: string,
  otlpPort = DEFAULT_OTLP_PORT,
  script = hookScriptPath(),
  telemetry = true,
  otlpKey?: string,
): { settings: Json; report: MergeReport } {
  const report: MergeReport = { env_added: [], env_changed: [], env_removed: [], hooks_added: [], hooks_updated: [], hooks_deduplicated: [], changed: false };
  const out: Json = { ...existing };

  // env: add Postrun's keys; keep every other key as is.
  const currentEnv = existing["env"];
  if (currentEnv !== undefined && !isObject(currentEnv)) throw new Error(`settings "env" is not an object; refusing to merge`);
  const env: Json = { ...(currentEnv ?? {}) };
  const wanted = telemetry ? captureEnv(captureDir, otlpPort, otlpKey) : { POSTRUN_CAPTURE_DIR: captureDir };
  if (!telemetry) {
    // Hooks only: take back any telemetry keys Postrun set earlier, never the user's own.
    for (const k of removeOwnTelemetry(env, currentEnv ?? {})) report.env_removed.push(k);
  }
  for (const [k, v] of Object.entries(wanted)) {
    if (!(k in env)) {
      env[k] = v;
      report.env_added.push(k);
    } else if (env[k] !== v) {
      report.env_changed.push({ key: k, from: env[k] });
      env[k] = v;
    }
  }
  for (const r of RETIRED_ENV) {
    // Judge by the settings as they were before this merge: the endpoint check must see the user's value.
    if (r.key in env && r.ours(env[r.key], currentEnv ?? {})) {
      delete env[r.key];
      report.env_removed.push(r.key);
    }
  }
  out["env"] = env;

  // hooks: one Postrun hook per event, updated in place when present.
  const currentHooks = existing["hooks"];
  if (currentHooks !== undefined && !isObject(currentHooks)) throw new Error(`settings "hooks" is not an object; refusing to merge`);
  const hooks: Json = { ...(currentHooks ?? {}) };
  const desired = captureHook(script);
  for (const event of HOOK_EVENTS) {
    const groupsRaw = hooks[event];
    if (groupsRaw !== undefined && !Array.isArray(groupsRaw)) throw new Error(`settings hooks.${event} is not an array; refusing to merge`);
    const groups = (groupsRaw ?? []) as unknown[];
    let kept = false;
    let updated = false;
    let removed = 0;
    const nextGroups: unknown[] = [];
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group["hooks"])) {
        nextGroups.push(group);
        continue;
      }
      const inner: unknown[] = [];
      let touched = false;
      for (const hook of group["hooks"] as unknown[]) {
        if (!isPostrunHook(hook, script)) {
          inner.push(hook);
          continue;
        }
        if (kept) {
          removed++;
          touched = true;
          continue;
        }
        kept = true;
        const same = isObject(hook) && hook["command"] === desired.command && hook["type"] === desired.type && hook["timeout"] === desired.timeout && Object.keys(hook).length === 3;
        // `desired.command` is shell-quoted when the path needs it; an older bare or differently quoted entry is rewritten.
        if (!same) {
          updated = true;
          touched = true;
        }
        inner.push(same ? hook : { ...desired });
      }
      if (inner.length === 0 && touched) continue; // group held only Postrun hooks that were removed or moved
      nextGroups.push(touched ? { ...group, hooks: inner } : group);
    }
    if (!kept) {
      nextGroups.push({ hooks: [{ ...desired }] });
      report.hooks_added.push(event);
    } else if (updated) {
      report.hooks_updated.push(event);
    }
    for (let i = 0; i < removed; i++) report.hooks_deduplicated.push(event);
    hooks[event] = nextGroups;
  }
  out["hooks"] = hooks;

  report.changed =
    report.env_added.length > 0 ||
    report.env_changed.length > 0 ||
    report.env_removed.length > 0 ||
    report.hooks_added.length > 0 ||
    report.hooks_updated.length > 0 ||
    report.hooks_deduplicated.length > 0;
  return { settings: out, report };
}

export interface ConfigureOptions {
  captureDir: string;
  otlpPort?: number;
  settingsPath?: string;
  /** Defaults to `${settingsPath}${BACKUP_SUFFIX}`. */
  backupPath?: string;
  script?: string;
  /** Ask Claude Code for telemetry (cost, tokens). False records from hooks only. Default true. */
  telemetry?: boolean;
  /** The telemetry key Claude Code sends in its export headers (~/.postrun/otlp-key). */
  otlpKey?: string;
}

export interface ConfigureResult extends MergeReport {
  settings_path: string;
  backup_path: string;
  /** True when this run wrote the backup (false when one already existed or there was nothing to back up). */
  backed_up: boolean;
  created: boolean;
  hook_script: string;
  hook_script_chmod: boolean;
}

function readSettings(path: string): Json | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${path} is not valid JSON (${(err as Error).message}); fix it by hand, nothing was changed`);
  }
  if (!isObject(parsed)) throw new Error(`${path} is not a JSON object; nothing was changed`);
  return parsed;
}

function writeSettings(path: string, settings: Json, created: boolean): void {
  // Keep the file's existing permissions; a new file gets the usual 0644.
  const mode = created ? 0o644 : statSync(path).mode & 0o777;
  const tmp = `${path}.postrun-tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}

function ensureExecutable(script: string): boolean {
  if (!existsSync(script)) throw new Error(`hook script missing: ${script}`);
  const mode = statSync(script).mode & 0o777;
  if ((mode & 0o100) === 0o100) return false;
  // Owner execute is all Claude Code needs; the script stays private if it was.
  chmodSync(script, mode | 0o100);
  return true;
}

/** True when settings already hold every Postrun env var and one Postrun hook per event pointing at the repo script. */
export function isClaudeCodeConfigured(opts: ConfigureOptions): boolean {
  const settingsPath = opts.settingsPath ?? defaultSettingsPath();
  let existing: Json | undefined;
  try {
    existing = readSettings(settingsPath);
  } catch {
    return false;
  }
  if (!existing) return false;
  try {
    return !mergeCaptureSettings(existing, opts.captureDir, opts.otlpPort ?? DEFAULT_OTLP_PORT, opts.script ?? hookScriptPath(), opts.telemetry ?? true).report.changed;
  } catch {
    return false;
  }
}

/**
 * Merge Postrun's configuration into settings.json on disk. Backs up first
 * (only when no backup exists yet), writes atomically via rename, and makes
 * the hook script executable. Safe to run any number of times.
 */
export function configureClaudeCode(opts: ConfigureOptions): ConfigureResult {
  const settingsPath = opts.settingsPath ?? defaultSettingsPath();
  const backupPath = opts.backupPath ?? `${settingsPath}${BACKUP_SUFFIX}`;
  const script = opts.script ?? hookScriptPath();
  const otlpPort = opts.otlpPort ?? DEFAULT_OTLP_PORT;

  const existing = readSettings(settingsPath);
  const created = existing === undefined;
  const { settings, report } = mergeCaptureSettings(existing ?? {}, opts.captureDir, otlpPort, script, opts.telemetry ?? true, opts.otlpKey);

  let backedUp = false;
  if (report.changed || created) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    if (!created && !existsSync(backupPath)) {
      copyFileSync(settingsPath, backupPath);
      backedUp = true;
    }
    writeSettings(settingsPath, settings, created);
  }
  const chmodded = ensureExecutable(script);

  return { ...report, settings_path: settingsPath, backup_path: backupPath, backed_up: backedUp, created, hook_script: script, hook_script_chmod: chmodded };
}

/** One-line human summary of a configure result. */
export function describeConfigure(r: ConfigureResult): string {
  const parts: string[] = [];
  if (r.created) parts.push("created settings.json");
  if (r.env_added.length > 0) parts.push(`added ${r.env_added.length} env var(s)`);
  if (r.env_changed.length > 0) parts.push(`replaced ${r.env_changed.map((c) => `${c.key} (was ${JSON.stringify(c.from)})`).join(", ")}`);
  if (r.env_removed.length > 0) parts.push(`removed ${r.env_removed.join(", ")}, which Postrun no longer uses`);
  if (r.hooks_added.length > 0) parts.push(`added hooks for ${r.hooks_added.join(", ")}`);
  if (r.hooks_updated.length > 0) parts.push(`updated existing Postrun hooks for ${r.hooks_updated.join(", ")}`);
  if (r.hooks_deduplicated.length > 0) parts.push(`removed ${r.hooks_deduplicated.length} duplicate Postrun hook(s)`);
  if (r.hook_script_chmod) parts.push("made the hook script executable");
  const what = parts.length > 0 ? parts.join("; ") : "already configured, nothing changed";
  const backup = r.backed_up ? `; original backed up to ${r.backup_path}` : "";
  return `Postrun is configured for Claude Code in ${r.settings_path} (${what}${backup}). Any Claude Code session that is already running must be restarted once to start capturing.`;
}

export interface UnconfigureResult {
  settings_path: string;
  env_removed: string[];
  hooks_removed: string[];
  changed: boolean;
}

/**
 * Take Postrun out of settings.json: every Postrun hook, POSTRUN_CAPTURE_DIR,
 * and the telemetry keys Postrun set (a key that already had the same value
 * before Postrun, per the backup, is kept). Everything else is left exactly as
 * it is. The backup file is left in place.
 */
export function unconfigureClaudeCode(opts: { settingsPath?: string; backupPath?: string } = {}): UnconfigureResult {
  const settingsPath = opts.settingsPath ?? defaultSettingsPath();
  const backupPath = opts.backupPath ?? `${settingsPath}${BACKUP_SUFFIX}`;
  const result: UnconfigureResult = { settings_path: settingsPath, env_removed: [], hooks_removed: [], changed: false };
  const existing = readSettings(settingsPath);
  if (!existing) return result;
  let before: Json | undefined;
  try {
    const b = readSettings(backupPath)?.["env"];
    before = isObject(b) ? b : {};
  } catch {
    before = undefined;
  }
  const out: Json = { ...existing };

  const env = existing["env"];
  if (isObject(env)) {
    const next: Json = { ...env };
    result.env_removed.push(...removeOwnTelemetry(next, env, before));
    if (typeof next["POSTRUN_CAPTURE_DIR"] === "string") {
      delete next["POSTRUN_CAPTURE_DIR"];
      result.env_removed.push("POSTRUN_CAPTURE_DIR");
    }
    if (Object.keys(next).length === 0) delete out["env"];
    else out["env"] = next;
  }

  const hooks = existing["hooks"];
  if (isObject(hooks)) {
    const next: Json = {};
    for (const [event, groupsRaw] of Object.entries(hooks)) {
      if (!Array.isArray(groupsRaw)) {
        next[event] = groupsRaw;
        continue;
      }
      const groups: unknown[] = [];
      let removed = false;
      for (const group of groupsRaw) {
        if (!isObject(group) || !Array.isArray(group["hooks"])) {
          groups.push(group);
          continue;
        }
        const inner = (group["hooks"] as unknown[]).filter((h) => !isPostrunHook(h));
        if (inner.length === group["hooks"].length) {
          groups.push(group);
          continue;
        }
        removed = true;
        if (inner.length > 0) groups.push({ ...group, hooks: inner });
      }
      if (removed) result.hooks_removed.push(event);
      if (groups.length > 0) next[event] = groups;
    }
    if (Object.keys(next).length === 0) delete out["hooks"];
    else out["hooks"] = next;
  }

  result.changed = result.env_removed.length > 0 || result.hooks_removed.length > 0;
  if (result.changed) writeSettings(settingsPath, out, false);
  return result;
}
