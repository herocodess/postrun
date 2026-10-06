/** Installing the Claude Code hook script where it survives updates: ~/.postrun/bin/capture-hook.sh. */

import { chmodSync, copyFileSync, mkdirSync, renameSync } from "node:fs";
import { ensurePrivateDir, PRIVATE_DIR_MODE } from "../util/files.js";
import { bundledHookScript } from "./assets.js";
import type { Paths } from "./paths.js";

export function installHook(p: Paths): void {
  ensurePrivateDir(p.home);
  mkdirSync(p.bin, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodSync(p.bin, PRIVATE_DIR_MODE);
  // Copy then rename: a hook firing during an update never sees half a file.
  const tmp = `${p.hook}.tmp-${process.pid}`;
  copyFileSync(bundledHookScript(), tmp);
  chmodSync(tmp, 0o700);
  renameSync(tmp, p.hook);
}
