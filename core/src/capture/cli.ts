/**
 * pnpm capture              start the OTLP receiver and both watchers; keep running
 * pnpm capture --once       ingest everything that is on disk now, then exit
 * pnpm capture:cc:setup     print the ~/.claude/settings.json additions (no edits)
 *
 * Env: POSTRUN_CAPTURE_DIR (default ~/.postrun/captures), POSTRUN_CLINE_DIR
 * (default ~/.cline/data/sessions), POSTRUN_OTLP_PORT (default 4318), POSTRUN_DB.
 * Everything binds to 127.0.0.1.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { PostrunStore, defaultDbPath } from "../store/index.js";
import { createClaudeCodeWatcher } from "./claude-code-watcher.js";
import { createClineWatcher } from "./cline-watcher.js";
import { createOtlpReceiver, DEFAULT_OTLP_PORT, OtlpPortInUseError } from "./receiver.js";
import { renderSetup } from "./setup.js";

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (line: string) => process.stdout.write(`[${stamp()}] ${line}\n`);

async function main(argv: string[]): Promise<number> {
  const captureDir = resolve(env("POSTRUN_CAPTURE_DIR", join(homedir(), ".postrun", "captures")));
  const clineDir = resolve(env("POSTRUN_CLINE_DIR", join(homedir(), ".cline", "data", "sessions")));
  const otlpPort = Number(env("POSTRUN_OTLP_PORT", String(DEFAULT_OTLP_PORT)));
  const dbPath = defaultDbPath();

  if (argv.includes("setup")) {
    process.stdout.write(renderSetup(captureDir, otlpPort) + "\n");
    return 0;
  }
  if (!Number.isInteger(otlpPort) || otlpPort < 1 || otlpPort > 65535) {
    process.stderr.write(`postrun capture: invalid POSTRUN_OTLP_PORT "${process.env["POSTRUN_OTLP_PORT"]}"\n`);
    return 2;
  }
  const once = argv.includes("--once");

  const store = new PostrunStore({ path: dbPath });
  const cc = createClaudeCodeWatcher({ captureDir, store, log });
  const cline = createClineWatcher({ sessionsDir: clineDir, store, log });

  if (once) {
    log(`store: ${dbPath}`);
    const ccSessions = new Map<string, { ended: boolean }>();
    cc.start();
    for (const [id, s] of cc.sessions()) ccSessions.set(id, s);
    cc.stop();
    cline.start();
    cline.stop();
    const c = store.counts();
    log(`done: ${c.sessions} session(s) in store, ${c.steps} steps`);
    store.close();
    return 0;
  }

  const receiver = createOtlpReceiver({ captureDir, port: otlpPort, log: (l) => log(`otlp: ${l}`) });
  try {
    const { url } = await receiver.start();
    log(`otlp receiver on ${url} (127.0.0.1 only) -> ${captureDir}/otlp-*.ndjson`);
  } catch (err) {
    process.stderr.write(`postrun capture: ${err instanceof OtlpPortInUseError ? err.message : (err as Error).message}\n`);
    store.close();
    return 1;
  }
  log(`store: ${dbPath}`);
  cc.start();
  cline.start();
  log(`claude-code hooks: ${captureDir}/hooks.ndjson (run \`pnpm capture:cc:setup\` if hooks/env are not configured)`);
  log(`watching. ctrl-c to stop.`);

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    log("stopping");
    cc.stop();
    cline.stop();
    void receiver.stop().finally(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return -1;
}

main(process.argv.slice(2)).then((code) => {
  if (code >= 0) process.exit(code);
});
