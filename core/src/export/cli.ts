/**
 * pnpm export <session-id> [-o <file>] [--db <path>]
 *
 * Writes one redacted, self-contained HTML report for a stored session and
 * lists every value it masked, so you can check before sending it anywhere.
 * Redaction cannot be switched off. Default output: ./postrun-<agent>-<date>-<id>.html
 */

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostrunStore, defaultDbPath } from "../store/index.js";
import { exportSession } from "./index.js";

function usage(): string {
  return `usage: pnpm export <session-id> [-o <file>] [--force] [--db <path>]\n` + `List session ids with: pnpm sessions\n`;
}

function main(argv: string[]): number {
  let id: string | undefined;
  let out: string | undefined;
  let db: string | undefined;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "-o" || a === "--out") out = next();
    else if (a.startsWith("--out=")) out = a.slice(6);
    else if (a === "--db") db = next();
    else if (a.startsWith("--db=")) db = a.slice(5);
    else if (a === "--force" || a === "-f") force = true;
    else if (a === "-h" || a === "--help") {
      process.stdout.write(usage());
      return 0;
    } else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
    else if (id === undefined) id = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!id) {
    process.stderr.write(usage());
    return 2;
  }

  const store = new PostrunStore({ path: db ? resolve(db) : defaultDbPath() });
  try {
    const session = store.getSession(id);
    if (!session) {
      process.stderr.write(`postrun export: no session ${id} in ${store.path}. List them with: pnpm sessions\n`);
      return 1;
    }
    const result = exportSession(session);
    const path = resolve(out ?? result.filename);
    if (existsSync(path) && !force) {
      process.stderr.write(`postrun export: ${path} exists; pass --force to overwrite\n`);
      return 1;
    }
    writeFileSync(path, result.html, { mode: 0o600 });

    const { findings, home_paths } = result.redaction;
    process.stdout.write(`wrote ${path} (${(Buffer.byteLength(result.html) / 1024).toFixed(0)} KB, ${session.steps.length} steps)\n`);
    if (findings.length === 0) {
      process.stdout.write(`redaction: no secrets detected${home_paths ? `; ${home_paths} home path(s) shown as ~` : ""}\n`);
    } else {
      process.stdout.write(`redaction: masked ${findings.length} value(s)${home_paths ? ` and ${home_paths} home path(s)` : ""}. Check them before sharing:\n`);
      for (const f of findings) process.stdout.write(`  ${f.kind.padEnd(15)} ${f.location}\n      ${f.context}\n`);
    }
    process.stdout.write(`Redaction is automatic, not a guarantee. Skim the report before you send it.\n`);
    return 0;
  } finally {
    store.close();
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`postrun export: ${(err as Error).message}\n`);
  process.exitCode = 2;
}
