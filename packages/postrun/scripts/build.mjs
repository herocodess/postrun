/**
 * Builds the npm package into dist/:
 *   dist/postrun.js        entry: Node version check, then loads main.js
 *   dist/main.js           the whole command, bundled, no dependencies
 *   dist/ui/               the review app (static export of apps/ui)
 *   dist/capture-hook.sh   the Claude Code hook script, copied to ~/.postrun/bin by setup
 */

import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(pkgDir, "..", "..");
const dist = join(pkgDir, "dist");
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

// The review app type-checks against Node 22's types (node:sqlite). An old install lacks them.
if (!existsSync(join(repo, "apps", "ui", "node_modules", "@types", "node", "sqlite.d.ts"))) {
  console.error("Dependencies are out of date. Run `pnpm install` at the repository root, then build again.");
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });

// The review app.
if (process.env.POSTRUN_SKIP_UI_BUILD !== "1") {
  execFileSync("pnpm", ["--filter", "@postrun/ui", "build"], { cwd: repo, stdio: "inherit" });
}
const ui = join(repo, "apps", "ui", "out");
if (!existsSync(join(ui, "index.html"))) throw new Error(`review app not built: ${ui}/index.html missing`);
cpSync(ui, join(dist, "ui"), { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  logLevel: "warning",
  define: { __POSTRUN_VERSION__: JSON.stringify(version) },
};

await build({ ...common, entryPoints: [join(repo, "core", "src", "cli", "main.ts")], outfile: join(dist, "main.js") });
await build({ ...common, entryPoints: [join(repo, "core", "src", "cli", "postrun.ts")], outfile: join(dist, "postrun.js"), external: ["./main.js"] });
chmodSync(join(dist, "postrun.js"), 0o755);

cpSync(join(repo, "core", "scripts", "capture-hook.sh"), join(dist, "capture-hook.sh"));
chmodSync(join(dist, "capture-hook.sh"), 0o755);

const entry = readFileSync(join(dist, "postrun.js"), "utf8");
if (!entry.startsWith("#!/usr/bin/env node")) writeFileSync(join(dist, "postrun.js"), `#!/usr/bin/env node\n${entry}`);
if (/from ["'](?!node:|\.\/main\.js)[^"']+["']/.test(readFileSync(join(dist, "main.js"), "utf8"))) {
  throw new Error("main.js imports a package that is not bundled");
}

const kb = (f) => `${Math.round(statSync(join(dist, f)).size / 1024)} KB`;
console.log(`postrun ${version}: dist/main.js ${kb("main.js")}, dist/postrun.js ${kb("postrun.js")}, review app copied`);
