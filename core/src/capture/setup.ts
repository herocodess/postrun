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

export function captureEnv(captureDir: string, otlpPort = DEFAULT_OTLP_PORT): Record<string, string> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_TRACES_EXPORTER: "otlp",
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
    OTEL_METRIC_EXPORT_INTERVAL: "10000",
    OTEL_LOGS_EXPORT_INTERVAL: "2000",
    OTEL_TRACES_EXPORT_INTERVAL: "2000",
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
const RETIRED_ENV: Array<{ key: string; ours: (value: unknown) => boolean }> = [
  { key: "OTEL_LOG_RAW_API_BODIES", ours: (v) => typeof v === "string" && /^file:.*[\\/]\.postrun[\\/].*api-bodies$/.test(v) },
];

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
export function mergeCaptureSettings(existing: Json, captureDir: string, otlpPort = DEFAULT_OTLP_PORT, script = hookScriptPath()): { settings: Json; report: MergeReport } {
  const report: MergeReport = { env_added: [], env_changed: [], env_removed: [], hooks_added: [], hooks_updated: [], hooks_deduplicated: [], changed: false };
  const out: Json = { ...existing };

  // env: add Postrun's keys; keep every other key as is.
  const currentEnv = existing["env"];
  if (currentEnv !== undefined && !isObject(currentEnv)) throw new Error(`settings "env" is not an object; refusing to merge`);
  const env: Json = { ...(currentEnv ?? {}) };
  for (const [k, v] of Object.entries(captureEnv(captureDir, otlpPort))) {
    if (!(k in env)) {
      env[k] = v;
      report.env_added.push(k);
    } else if (env[k] !== v) {
      report.env_changed.push({ key: k, from: env[k] });
      env[k] = v;
    }
  }
  for (const r of RETIRED_ENV) {
    if (r.key in env && r.ours(env[r.key])) {
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

function ensureExecutable(script: string): boolean {
  if (!existsSync(script)) throw new Error(`hook script missing: ${script}`);
  const mode = statSync(script).mode & 0o777;
  if ((mode & 0o111) === 0o111) return false;
  chmodSync(script, mode | 0o111);
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
    return !mergeCaptureSettings(existing, opts.captureDir, opts.otlpPort ?? DEFAULT_OTLP_PORT, opts.script ?? hookScriptPath()).report.changed;
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
  const { settings, report } = mergeCaptureSettings(existing ?? {}, opts.captureDir, otlpPort, script);

  let backedUp = false;
  if (report.changed || created) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    if (!created && !existsSync(backupPath)) {
      copyFileSync(settingsPath, backupPath);
      backedUp = true;
    }
    // Keep the file's existing permissions; a new file gets the usual 0644.
    const mode = created ? 0o644 : statSync(settingsPath).mode & 0o777;
    const tmp = `${settingsPath}.postrun-tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", { mode });
    chmodSync(tmp, mode);
    renameSync(tmp, settingsPath);
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
  if (r.env_removed.length > 0) parts.push(`removed retired ${r.env_removed.join(", ")} (Postrun never read those files; delete the directory by hand if you want)`);
  if (r.hooks_added.length > 0) parts.push(`added hooks for ${r.hooks_added.join(", ")}`);
  if (r.hooks_updated.length > 0) parts.push(`updated existing Postrun hooks for ${r.hooks_updated.join(", ")}`);
  if (r.hooks_deduplicated.length > 0) parts.push(`removed ${r.hooks_deduplicated.length} duplicate Postrun hook(s)`);
  if (r.hook_script_chmod) parts.push("made the hook script executable");
  const what = parts.length > 0 ? parts.join("; ") : "already configured, nothing changed";
  const backup = r.backed_up ? `; original backed up to ${r.backup_path}` : "";
  return `Postrun is configured for Claude Code in ${r.settings_path} (${what}${backup}). Any Claude Code session that is already running must be restarted once to start capturing.`;
}
