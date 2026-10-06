#!/usr/bin/env node
/**
 * Launch gate for postrun.app, run after `next build`.
 *
 * Checks the built site in out/ for things that must not reach production:
 *   - unfilled placeholders like [LEGAL ENTITY NAME] in any indexable page
 *     or in .well-known/security.txt
 *   - security.txt past its Expires date
 *   - the waitlist form with no endpoint, or an endpoint the CSP in
 *     vercel.json would block
 *
 * On a Vercel production deployment (VERCEL_ENV=production) or with --strict,
 * any problem fails the build. Everywhere else it prints warnings and passes,
 * so local builds and preview deployments keep working while drafts exist.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");
const strict = process.env["VERCEL_ENV"] === "production" || process.argv.includes("--strict");

/** Bracketed upper-case tokens are placeholders; [REDACTED] is product copy. */
const PLACEHOLDER = /\[[A-Z][A-Z ]*[A-Z]\]/g;
const ALLOWED = new Set(["[REDACTED]"]);

const problems = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

if (!existsSync(out)) {
  console.error("prod-check: out/ not found, run next build first");
  process.exit(1);
}

// 1. Placeholders in pages people can find. The demo app and the example
//    report are generated product output; noindex pages (drafts, 404) are skipped.
for (const file of walk(out)) {
  const rel = relative(out, file);
  if (!rel.endsWith(".html") || rel.startsWith("demo/") || rel === "example-report.html") continue;
  const html = readFileSync(file, "utf8");
  if (/<meta name="robots" content="[^"]*noindex/.test(html)) continue;
  const found = [...new Set((html.match(PLACEHOLDER) ?? []).filter((t) => !ALLOWED.has(t)))];
  if (found.length) problems.push(`${rel}: unfilled ${found.join(", ")}`);
}

// 2. security.txt: filled in and not expired.
const sec = join(out, ".well-known", "security.txt");
if (existsSync(sec)) {
  const txt = readFileSync(sec, "utf8");
  const found = [...new Set(txt.match(PLACEHOLDER) ?? [])];
  if (found.length) problems.push(`.well-known/security.txt: unfilled ${found.join(", ")}`);
  const expires = txt.match(/^Expires:\s*(.+)$/m)?.[1];
  if (!expires || Number.isNaN(Date.parse(expires)) || Date.parse(expires) < Date.now()) {
    problems.push(".well-known/security.txt: Expires is missing or in the past");
  }
} else {
  problems.push(".well-known/security.txt is missing");
}

// 3. Waitlist endpoint set, https, and allowed by the CSP's connect-src.
const waitlist = process.env["NEXT_PUBLIC_WAITLIST_URL"] ?? "";
if (!waitlist) {
  problems.push("NEXT_PUBLIC_WAITLIST_URL is not set, so the early-access form can't take sign-ups");
} else {
  let origin = "";
  try {
    const u = new URL(waitlist);
    if (u.protocol !== "https:") problems.push("NEXT_PUBLIC_WAITLIST_URL must be https");
    origin = u.origin;
  } catch {
    problems.push("NEXT_PUBLIC_WAITLIST_URL is not a valid URL");
  }
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  const csp = vercel.headers
    .flatMap((h) => h.headers)
    .find((h) => h.key === "Content-Security-Policy")?.value ?? "";
  const connect = csp.match(/connect-src ([^;]+)/)?.[1].split(/\s+/) ?? [];
  if (origin && !connect.includes(origin)) {
    problems.push(`vercel.json CSP connect-src must include ${origin} or the waitlist form is blocked`);
  }
}

if (problems.length === 0) {
  console.log("prod-check: ready for production");
  process.exit(0);
}

const head = strict ? "prod-check: NOT ready for production" : "prod-check: warnings (fatal on production deploys)";
console[strict ? "error" : "warn"](`\n${head}\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
process.exit(strict ? 1 : 0);
