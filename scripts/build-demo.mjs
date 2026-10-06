#!/usr/bin/env node
/**
 * pnpm demo:build
 *
 * Builds the public demo at postrun.app/demo and refreshes the example report:
 *   1. builds apps/ui in demo mode (static, base path /demo) into apps/ui/out-demo
 *   2. copies it to apps/web/public/demo
 *   3. writes the example sessions' API responses and exports to apps/web/public/demo/data
 *   4. copies the uploader session's export to apps/web/public/example-report.html
 * The output is committed, so deploying apps/web needs no native build steps.
 * Re-run after changing apps/ui, the exporter, or core/src/demo/sessions.ts.
 */
import { execFileSync } from "node:child_process";
import { cpSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (args) => execFileSync("pnpm", args, { cwd: root, stdio: "inherit" });
const web = join(root, "apps/web/public");

run(["--filter", "@postrun/ui", "build:demo"]);
rmSync(join(web, "demo"), { recursive: true, force: true });
cpSync(join(root, "apps/ui/out-demo"), join(web, "demo"), { recursive: true });
run(["--filter", "@postrun/core", "demo:data", join(web, "demo/data")]);
copyFileSync(join(web, "demo/data/exports/8f3c2a71-demo-uploader.html"), join(web, "example-report.html"));
console.log("demo built into apps/web/public/demo; example-report.html refreshed");
