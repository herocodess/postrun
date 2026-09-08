#!/usr/bin/env bash
# Postrun hook capture for Claude Code.
# Register for SessionStart, UserPromptSubmit, PostToolUse, PostToolUseFailure,
# Stop, SessionEnd (run `pnpm capture:cc:setup` to print the settings block).
#
# Claude Code passes one JSON object on stdin per hook invocation. PostToolUse
# carries the COMPLETE tool_input and tool_response, which is why this channel
# is the primary content source. tool_use_id joins to the OTel tool_result.
#
# Contract with Claude Code:
# - print NOTHING to stdout (JSON stdout is interpreted as a decision)
# - exit 0 always, fast. Capture must never block or perturb the agent.
#
# Output: one NDJSON line appended to $POSTRUN_CAPTURE_DIR/hooks.ndjson
# (default ~/.postrun/captures), shape {received_at, channel:"hook", payload}.

set -u
DIR="${POSTRUN_CAPTURE_DIR:-$HOME/.postrun/captures}"
mkdir -p "$DIR" 2>/dev/null || exit 0

PAYLOAD="$(cat)" || exit 0
[ -z "$PAYLOAD" ] && exit 0

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"received_at":"%s","channel":"hook","payload":%s}\n' "$TS" "$PAYLOAD" >> "$DIR/hooks.ndjson" 2>/dev/null

exit 0
