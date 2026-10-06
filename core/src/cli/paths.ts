/**
 * Where the `postrun` command keeps things, and its small settings file.
 *
 * Everything lives under one folder, ~/.postrun by default (POSTRUN_HOME
 * overrides it, which the install test uses to run in a throwaway home).
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_OTLP_PORT } from "../capture/receiver.js";
import { DEFAULT_PORT } from "../server/server.js";
import { ensurePrivateDir, PRIVATE_FILE_MODE } from "../util/files.js";

export interface Paths {
  home: string;
  db: string;
  captures: string;
  token: string;
  bin: string;
  hook: string;
  pid: string;
  log: string;
  config: string;
  claudeSettings: string;
  clineSessions: string;
}

export function paths(env: NodeJS.ProcessEnv = process.env): Paths {
  const userHome = env["HOME"] ?? homedir();
  const home = resolve(env["POSTRUN_HOME"] ?? join(userHome, ".postrun"));
  return {
    home,
    db: resolve(env["POSTRUN_DB"] ?? join(home, "postrun.db")),
    captures: resolve(env["POSTRUN_CAPTURE_DIR"] ?? join(home, "captures")),
    token: resolve(env["POSTRUN_INGEST_TOKEN_FILE"] ?? join(home, "ingest-token")),
    bin: join(home, "bin"),
    hook: join(home, "bin", "capture-hook.sh"),
    pid: join(home, "postrun.pid"),
    log: join(home, "postrun.log"),
    config: join(home, "config.json"),
    claudeSettings: resolve(env["POSTRUN_CLAUDE_SETTINGS"] ?? join(userHome, ".claude", "settings.json")),
    clineSessions: resolve(env["POSTRUN_CLINE_DIR"] ?? join(userHome, ".cline", "data", "sessions")),
  };
}

export interface Config {
  /** Review app and API, on 127.0.0.1. */
  port: number;
  /** Claude Code telemetry receiver, on 127.0.0.1. */
  otlpPort: number;
  /** False when the user already sends Claude Code telemetry elsewhere: record from hooks only. */
  telemetry: boolean;
  /** Hours a quiet session's raw logs are kept; 0 keeps them. */
  rawLogHours: number;
  /** Desktop notification when a running session fails several steps in a row. */
  notifyFailures: boolean;
  /** Check npm once a day for a newer version. Off unless the user turns it on. */
  updateCheck: boolean;
}

export const DEFAULT_CONFIG: Config = { port: DEFAULT_PORT, otlpPort: DEFAULT_OTLP_PORT, telemetry: true, rawLogHours: 24, notifyFailures: false, updateCheck: false };

function validPort(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535;
}

export function readConfig(p: Paths): Config {
  let raw: Record<string, unknown> = {};
  try {
    if (existsSync(p.config)) raw = JSON.parse(readFileSync(p.config, "utf8")) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  return {
    port: validPort(raw["port"]) ? raw["port"] : DEFAULT_CONFIG.port,
    otlpPort: validPort(raw["otlpPort"]) ? raw["otlpPort"] : DEFAULT_CONFIG.otlpPort,
    telemetry: typeof raw["telemetry"] === "boolean" ? raw["telemetry"] : DEFAULT_CONFIG.telemetry,
    rawLogHours:
      typeof raw["rawLogHours"] === "number" && Number.isInteger(raw["rawLogHours"]) && raw["rawLogHours"] >= 0 ? raw["rawLogHours"] : DEFAULT_CONFIG.rawLogHours,
    notifyFailures: typeof raw["notifyFailures"] === "boolean" ? raw["notifyFailures"] : DEFAULT_CONFIG.notifyFailures,
    updateCheck: typeof raw["updateCheck"] === "boolean" ? raw["updateCheck"] : DEFAULT_CONFIG.updateCheck,
  };
}

export function writeConfig(p: Paths, config: Config): void {
  ensurePrivateDir(p.home);
  const tmp = `${p.config}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: PRIVATE_FILE_MODE });
  renameSync(tmp, p.config);
}
