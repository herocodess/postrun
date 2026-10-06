/**
 * pnpm serve [--port <n>] [--db <path>] [--ui <dir>]
 *
 * Serves the session store. Port precedence: --port flag, then PORT env, then 1234.
 * Always binds to 127.0.0.1. Ingest sessions first with `pnpm ingest`.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDbPath } from "../store/index.js";
import { createPostrunServer, DEFAULT_PORT, PortInUseError } from "./server.js";
import { defaultTokenPath, loadOrCreateToken } from "./token.js";

interface Args {
  port: number;
  dbPath: string;
  uiDir: string;
}

function defaultUiDir(): string {
  // This file runs from core/src/server (tsx) or core/dist/server (node); both are three levels below the repo root.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..", "apps", "ui", "out");
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Args {
  let portFlag: string | undefined;
  let db: string | undefined;
  let ui: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--port" || a === "-p") portFlag = next();
    else if (a?.startsWith("--port=")) portFlag = a.slice("--port=".length);
    else if (a === "--db") db = next();
    else if (a?.startsWith("--db=")) db = a.slice("--db=".length);
    else if (a === "--ui") ui = next();
    else if (a?.startsWith("--ui=")) ui = a.slice("--ui=".length);
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        `usage: pnpm serve [--port <n>] [--db <path>] [--ui <dir>]\n` +
          `  --port  port on 127.0.0.1 (flag > PORT env > ${DEFAULT_PORT})\n` +
          `  --db    SQLite store (flag > POSTRUN_DB env > ~/.postrun/postrun.db)\n` +
          `  --ui    built UI directory (default <repo>/apps/ui/out)\n` +
          `Adapters can push v1.2 batches to POST /api/ingest with the token in\n` +
          `POSTRUN_INGEST_TOKEN_FILE or ~/.postrun/ingest-token (created on first run).\n` +
          `Ingest sessions first: pnpm ingest --agent claude-code|cline <source>\n`,
      );
      process.exit(0);
    } else throw new Error(`unknown argument: ${a}`);
  }

  const portSource = portFlag !== undefined ? "--port" : env["PORT"] !== undefined ? "PORT" : "default";
  const portRaw = portFlag ?? env["PORT"] ?? String(DEFAULT_PORT);
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid port "${portRaw}" (from ${portSource}); expected an integer between 1 and 65535`);
  }
  return {
    port,
    dbPath: db !== undefined ? resolve(db) : defaultDbPath(env),
    uiDir: ui !== undefined ? resolve(ui) : defaultUiDir(),
  };
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2), process.env);
  } catch (err) {
    process.stderr.write(`postrun serve: ${(err as Error).message}\n`);
    return 2;
  }

  const tokenPath = defaultTokenPath(process.env);
  let ingestToken: string;
  try {
    ingestToken = loadOrCreateToken(tokenPath);
  } catch (err) {
    process.stderr.write(`postrun serve: ingest token: ${(err as Error).message}\n`);
    return 1;
  }

  let app;
  try {
    app = createPostrunServer({ port: args.port, dbPath: args.dbPath, uiDir: args.uiDir, ingestToken, requireKey: true });
  } catch (err) {
    process.stderr.write(`postrun serve: could not open store ${args.dbPath}: ${(err as Error).message}\n`);
    return 1;
  }

  try {
    const { url } = await app.start();
    const sessions = app.store.listSessions();
    process.stdout.write(`postrun store ${args.dbPath}: ${sessions.length} session(s)\n`);
    for (const s of sessions) process.stdout.write(`  ${s.started_at}  ${s.agent.kind.padEnd(11)} ${s.id}  ${s.steps_total} steps\n`);
    if (sessions.length === 0) process.stdout.write(`  (none yet; run: pnpm ingest --agent claude-code|cline <source>)\n`);
    process.stdout.write(`serving UI from ${args.uiDir}\n`);
    process.stdout.write(`ingest: POST ${url}api/ingest  (bearer token in ${tokenPath})\n`);
    process.stdout.write(`listening on ${url}  (127.0.0.1 only; ctrl-c to stop)\n`);
    process.stdout.write(`open the app with its key: ${url}#key=${ingestToken}\n`);
  } catch (err) {
    if (err instanceof PortInUseError) {
      process.stderr.write(`postrun serve: ${err.message}\n`);
      return 1;
    }
    process.stderr.write(`postrun serve: failed to start: ${(err as Error).message}\n`);
    return 1;
  }

  const shutdown = () => {
    void app.stop().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return -1; // keep running
}

main().then((code) => {
  if (code >= 0) process.exit(code);
});
