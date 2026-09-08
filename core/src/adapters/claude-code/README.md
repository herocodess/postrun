# Claude Code adapter

Reads a captures directory (`otlp-logs.ndjson` + `hooks.ndjson`) and emits schema `Step[]` for one session. Read only.

## Content-source rule (v1.1, corrected)

- **hook** is the primary content source: full `tool_input`, full `tool_response.stdout`, full prompt text.
- **otlp-logs** is never a content source. It is used only for ordering (`event.sequence`), correlation (`tool_use_id`, `prompt.id`, `request_id`, `message.uuid`), cost, and tokens.
- An otlp `tool_result` is joined to its hook record by `tool_use_id`. A step with no hook record gets empty content and an `output_ref` / `text_ref` pointer instead.

## Mapping

| otlp event | hook record | step |
| --- | --- | --- |
| `tool_result` Bash | PostToolUse / PostToolUseFailure | `command` |
| `tool_result` Edit / Write | PostToolUse | `edit` (`landed_in_final_state` left unset) |
| `tool_result` Read | PostToolUse | `read` |
| `tool_result` anything else | PostToolUse / PostToolUseFailure | `other` with the hook's full tool name |
| `user_prompt` | UserPromptSubmit (by `prompt_id`) | `message` role user |
| `assistant_response` main thread (`repl_main_thread`, or `sdk` for `claude -p`) | Stop `last_assistant_message` (final response of the turn only, length-guarded) | `message` role assistant; otherwise `text_ref` to the raw response body |
| `assistant_response` side calls (title generation, prompt suggestion) | none | `other` |
| everything else (`api_request`, `tool_decision`, `hook_execution_*`, ...) | | not a step; counted in `stats.non_step_events` |

`api_request` feeds `stats.totals`; `tool_decision` feeds `step.decision` (config-sourced accept is "auto", user-sourced accept is "accepted"). `step.outcome` comes from PostToolUseFailure or the otlp success flag. A step with no hook record is `content_status: "reference_only"` and its content fields are absent.

## Usage

```bash
pnpm -s adapter:cc ~/.postrun/captures > steps.json
```

Steps go to stdout as JSON; a one-line summary goes to stderr. Use `-s` so pnpm's script banner does not pollute stdout. Pass a session id as a second argument when otlp-logs holds more than one session, which a live capture directory always will; `listCaptureSessions(dir)` enumerates them, and `pnpm ingest --agent claude-code` without `--session` ingests all of them.

Programmatic: `readCaptureDir(dir)` or `adaptClaudeCode({ otlpLogs, hooks })` from `src/adapters/claude-code`.

## Tests

`adapter.test.ts` runs against the real files in `~/.postrun/captures` (override with `POSTRUN_CAPTURES`) and skips when they are absent.
