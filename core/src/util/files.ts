/**
 * Private file helpers. Everything Postrun writes holds prompts, tool output,
 * and telemetry from this machine, so directories are 0700 and files 0600
 * regardless of the process umask.
 */

import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/** mkdir -p with 0700, and tighten an existing directory that is wider than that. */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  tighten(dir, PRIVATE_DIR_MODE);
}

/** chmod 0600 when the file exists and is wider than that. */
export function ensurePrivateFile(path: string): void {
  if (existsSync(path)) tighten(path, PRIVATE_FILE_MODE);
}

function tighten(path: string, mode: number): void {
  const current = statSync(path).mode & 0o777;
  if ((current & ~mode) !== 0) chmodSync(path, mode);
}
