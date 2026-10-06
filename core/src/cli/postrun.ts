#!/usr/bin/env node
/**
 * Entry point. Checks the Node version and quiets Node's "SQLite is
 * experimental" notice before anything loads node:sqlite, then runs the
 * command. Kept free of static imports for that reason.
 */

const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  process.stderr.write(
    `Postrun needs Node 22.13 or newer; this is Node ${process.versions.node}.\n` + `Install a newer Node from https://nodejs.org (or with nvm: nvm install 22), then run postrun again.\n`,
  );
  process.exit(1);
}

const emit = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === "string" ? warning : warning.message;
  const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
  if (type === "ExperimentalWarning" && /SQLite/i.test(text)) return;
  (emit as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

const { main } = await import("./main.js");
const code = await main(process.argv.slice(2));
if (code >= 0) process.exit(code);
