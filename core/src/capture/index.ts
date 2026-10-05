export { createOtlpReceiver, OtlpPortInUseError, OTLP_HOST, DEFAULT_OTLP_PORT, MAX_BODY_BYTES } from "./receiver.js";
export type { OtlpReceiver, ReceiverOptions } from "./receiver.js";
export { createClaudeCodeWatcher } from "./claude-code-watcher.js";
export type { ClaudeCodeWatcher, ClaudeCodeWatcherOptions } from "./claude-code-watcher.js";
export { createClineWatcher } from "./cline-watcher.js";
export type { ClineWatcher, ClineWatcherOptions } from "./cline-watcher.js";
export {
  captureSettings,
  captureEnv,
  captureHook,
  hookScriptPath,
  defaultSettingsPath,
  isPostrunHook,
  mergeCaptureSettings,
  isClaudeCodeConfigured,
  configureClaudeCode,
  describeConfigure,
  shellQuote,
  shellUnquote,
  HOOK_EVENTS,
  BACKUP_SUFFIX,
} from "./setup.js";
export type { ConfigureOptions, ConfigureResult, MergeReport, HookCommand } from "./setup.js";
