/**
 * CLI: pnpm adapter:cline <session-id | session-dir | messages.json>
 *
 * Prints Step[] as JSON on stdout and a one-line summary on stderr. Read only.
 */

import { adaptCline } from "./adapter.js";
import { loadClineSession } from "./store.js";

function main(argv: string[]): number {
  const [target] = argv;
  if (!target) {
    process.stderr.write("usage: pnpm adapter:cline <session-id | session-dir | path/to/<id>.messages.json>\n");
    return 2;
  }
  const result = adaptCline(loadClineSession(target));
  process.stdout.write(JSON.stringify(result.steps, null, 2) + "\n");
  const s = result.stats;
  const byType = Object.entries(s.steps_by_type)
    .sort(([, a], [, b]) => b - a)
    .map(([t, n]) => `${t}=${n}`)
    .join(" ");
  const modes = Object.entries(s.turns_by_mode)
    .map(([m, n]) => `${m}=${n}`)
    .join(" ");
  process.stderr.write(
    `${s.steps_total} steps (${byType}); ${s.messages_total} messages; ${s.tool_uses} tool calls -> ${s.tool_use_items} items; ` +
      `${result.turns.length} turns (${modes}); ${s.proceed_while_running} proceed-while-running; ` +
      `failed=${s.outcome["failed"] ?? 0}; cost(metrics)=${s.totals.from_metrics.cost_usd.toFixed(4)}\n`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
