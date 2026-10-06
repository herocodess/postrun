#!/usr/bin/env node
/**
 * Release the `postrun` npm package in one command, from a clean, up-to-date main:
 *
 *   pnpm run release 0.3.0      (or: patch, minor; same as node scripts/release.mjs 0.3.0)
 *   pnpm run release 0.3.0 --dry   check everything, change nothing
 *
 * 1. Checks you're on main, with nothing uncommitted, level with origin.
 * 2. Checks the website changelog's newest entry is marked with this version,
 *    so every release says what changed.
 * 3. Sets the version in packages/postrun/package.json.
 * 4. Runs the typechecks, every test suite and the package install test.
 * 5. Commits "Release x.y.z", tags vx.y.z, pushes both.
 * 6. Publishes to npm (npm asks for your one-time code if you use two-factor).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const pkgFile = join(root, "packages/postrun/package.json");
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const want = args.find((a) => !a.startsWith("--"));

const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};
const step = (msg) => console.log(`\n▸ ${msg}`);
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const run = (cmd, a, cwd = root) => {
  const r = spawnSync(cmd, a, { cwd, stdio: "inherit" });
  if (r.status !== 0) fail(`${cmd} ${a.join(" ")} failed`);
};

if (!want) fail("Say which version: pnpm run release 0.3.0 (or patch, minor).");

const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
const published = (() => {
  try {
    return execFileSync("npm", ["view", "postrun", "version"], { encoding: "utf8" }).trim();
  } catch {
    return "0.0.0";
  }
})();
const [maj, min, pat] = published.split(".").map(Number);
const version = want === "patch" ? `${maj}.${min}.${pat + 1}` : want === "minor" ? `${maj}.${min + 1}.0` : want;
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`"${want}" isn't a version. Use x.y.z, patch or minor.`);
const newer = (a, b) => {
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
if (!newer(version, published)) fail(`npm already has ${published}; ${version} must be newer.`);

step(`Releasing postrun ${version} (npm has ${published})`);

step("Checking git");
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") fail("Switch to main first: git checkout main");
if (git("status", "--porcelain")) fail("Commit or stash your changes first.");
git("fetch", "-q", "origin", "main");
if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) fail("main isn't level with origin/main: git pull (or push) first.");
if (git("tag", "-l", `v${version}`)) fail(`Tag v${version} already exists.`);

step("Checking the changelog");
const changelog = readFileSync(join(root, "apps/web/content/changelog.ts"), "utf8");
const firstVersion = /RELEASES[^=]*=\s*\[\s*\{[^}]*?version:\s*"([^"]+)"/s.exec(changelog)?.[1];
if (firstVersion !== version)
  fail(`The newest entry in apps/web/content/changelog.ts should have version: "${version}" (it has ${firstVersion ? `"${firstVersion}"` : "none"}). Add what changed, then run this again.`);

step("Typechecks and tests");
run("pnpm", ["-r", "typecheck"]);
run("pnpm", ["--filter", "@postrun/core", "test"]);
run("pnpm", ["--filter", "@postrun/ui", "test"]);
run("pnpm", ["--filter", "@postrun/app", "test"]);

if (dry) {
  console.log(`\n✓ Everything checks out for ${version}. Nothing was changed (--dry).`);
  process.exit(0);
}

const bump = pkg.version !== version;
if (bump) {
  step(`Setting packages/postrun to ${version}`);
  pkg.version = version;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
}

step("Package install test (builds the package and installs it in a throwaway home)");
run("pnpm", ["--filter", "postrun", "test:install"]);

step("Commit, tag, push");
if (bump) run("git", ["commit", "-q", "-am", `Release ${version}`]);
run("git", ["tag", "-a", `v${version}`, "-m", `postrun ${version}`]);
run("git", ["push", "-q", "origin", "main", `v${version}`]);

step("Publishing to npm");
run("npm", ["publish"], join(root, "packages/postrun"));

console.log(`\n✓ postrun ${version} is on npm. Update with: npm install -g postrun@latest && postrun setup`);
