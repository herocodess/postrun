/**
 * Prints what to add to ~/.claude/settings.json so Claude Code sends telemetry
 * to the local receiver and runs the hook capture script. Never edits the file.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_OTLP_PORT, OTLP_HOST } from "./receiver.js";

export function hookScriptPath(): string {
  // core/src/capture (tsx) or core/dist/capture (node) -> core/scripts/capture-hook.sh
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "scripts", "capture-hook.sh");
}

export function captureSettings(captureDir: string, otlpPort = DEFAULT_OTLP_PORT): Record<string, unknown> {
  const hook = { type: "command", command: hookScriptPath(), timeout: 10 };
  const events = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PostToolUseFailure", "Stop", "SessionEnd"];
  return {
    env: {
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_TRACES_EXPORTER: "otlp",
      CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://${OTLP_HOST}:${otlpPort}`,
      OTEL_LOG_USER_PROMPTS: "1",
      OTEL_LOG_ASSISTANT_RESPONSES: "1",
      OTEL_LOG_TOOL_DETAILS: "1",
      OTEL_LOG_TOOL_CONTENT: "1",
      OTEL_LOG_RAW_API_BODIES: `file:${captureDir}/api-bodies`,
      OTEL_METRIC_EXPORT_INTERVAL: "10000",
      OTEL_LOGS_EXPORT_INTERVAL: "2000",
      OTEL_TRACES_EXPORT_INTERVAL: "2000",
      POSTRUN_CAPTURE_DIR: captureDir,
    },
    hooks: Object.fromEntries(events.map((e) => [e, [{ hooks: [hook] }]])),
  };
}

export function renderSetup(captureDir: string, otlpPort = DEFAULT_OTLP_PORT): string {
  const settings = captureSettings(captureDir, otlpPort);
  return [
    `Postrun capture setup for Claude Code (nothing has been changed; copy by hand).`,
    ``,
    `1. Merge this into ~/.claude/settings.json. The "env" block is read by Claude Code at startup`,
    `   for every session; the "hooks" block runs the capture script on each event.`,
    `   If you already have "env" or "hooks", merge the keys rather than replacing the objects.`,
    ``,
    JSON.stringify(settings, null, 2),
    ``,
    `2. Keep \`pnpm capture\` running in a terminal. It listens on ${OTLP_HOST}:${otlpPort} for OTLP`,
    `   and tails ${captureDir}/hooks.ndjson. Sessions are ingested on each Stop and on SessionEnd.`,
    ``,
    `3. Start claude as usual. Verify with \`pnpm sessions\` after the first turn.`,
    ``,
    `Note: the content flags (OTEL_LOG_*=1) capture prompts, responses, and tool content in full,`,
    `on this machine only. The hook script is ${hookScriptPath()} and must be executable.`,
  ].join("\n");
}
