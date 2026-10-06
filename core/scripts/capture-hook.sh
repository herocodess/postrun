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
# Output: one NDJSON line in its own file, $POSTRUN_CAPTURE_DIR/spool/<time>-<pid>-<n>.ndjson
# (default ~/.postrun/captures), shape {received_at, channel:"hook", payload}.
# The file is written under a hidden temporary name and then renamed, which is
# atomic: events written at the same moment never splice into each other.
# While recording is paused ($DIR/.paused exists) events are dropped.

set -u
# Payloads hold full prompts and tool output: owner-only files and directory.
umask 077
DIR="${POSTRUN_CAPTURE_DIR:-$HOME/.postrun/captures}"
SPOOL="$DIR/spool"

PAYLOAD="$(cat)" || exit 0
[ -z "$PAYLOAD" ] && exit 0
[ -e "$DIR/.paused" ] && exit 0
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LINE_FMT='{"received_at":"%s","channel":"hook","payload":%s}\n'

# Without a usable spool, fall back to the shared inbox: an event may splice with another one
# written at the same moment, but it is not dropped outright.
if ! mkdir -p "$SPOOL" 2>/dev/null || ! TMP="$(mktemp "$SPOOL/.in.XXXXXXXX" 2>/dev/null)"; then
  mkdir -p "$DIR" 2>/dev/null && printf "$LINE_FMT" "$TS" "$PAYLOAD" >> "$DIR/hooks.ndjson" 2>/dev/null
  exit 0
fi
if printf "$LINE_FMT" "$TS" "$PAYLOAD" > "$TMP" 2>/dev/null; then
  mv -f "$TMP" "$SPOOL/$(date -u +%Y%m%dT%H%M%S)-$$-${RANDOM}.ndjson" 2>/dev/null || rm -f "$TMP"
else
  rm -f "$TMP"
fi

exit 0
