/**
 * Files the command ships with: the built review app and the Claude Code hook
 * script. In the npm package they sit next to the bundled code (dist/ui,
 * dist/capture-hook.sh); in a checkout they are found in the repo.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

declare const __POSTRUN_VERSION__: string | undefined;

const here = dirname(fileURLToPath(import.meta.url));

function first(candidates: string[], what: string): string {
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`${what} not found (looked in ${candidates.join(", ")}); reinstall Postrun`);
  return found;
}

export function uiDir(): string {
  return first([join(here, "ui"), resolve(here, "..", "..", "..", "apps", "ui", "out")], "the review app");
}

export function bundledHookScript(): string {
  return first([join(here, "capture-hook.sh"), resolve(here, "..", "..", "scripts", "capture-hook.sh")], "the hook script");
}

export const VERSION: string = typeof __POSTRUN_VERSION__ === "string" ? __POSTRUN_VERSION__ : "0.0.0-dev";
