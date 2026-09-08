/**
 * CLI: pnpm adapter:cc <path-to-captures-dir> [session-id]
 *
 * Prints Step[] as JSON on stdout and a one-line summary on stderr, so the JSON
 * can be piped. Read only.
 */

import { readCaptureDir } from "./adapter.js";

function main(argv: string[]): number {
  const [dir, sessionId] = argv;
  if (!dir) {
    process.stderr.write("usage: pnpm adapter:cc <path-to-captures-dir> [session-id]\n");
    return 2;
  }
  const result = readCaptureDir(dir, sessionId);
  process.stdout.write(JSON.stringify(result.steps, null, 2) + "\n");

  const s = result.stats;
  const byType = Object.entries(s.steps_by_type)
    .sort(([, a], [, b]) => b - a)
    .map(([t, n]) => `${t}=${n}`)
    .join(" ");
  const skipped = result.lines.otlp_logs.skipped + result.lines.hooks.skipped;
  process.stderr.write(
    `${s.steps_total} steps (${byType}); ${skipped} lines skipped (otlp-logs=${result.lines.otlp_logs.skipped}, hooks=${result.lines.hooks.skipped}); ` +
      `tool_use_ids joined=${s.tool_results.joined} unjoined=${s.tool_results.unjoined.length}\n`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
