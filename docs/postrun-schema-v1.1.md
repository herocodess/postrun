# Postrun event schema v1.1 (draft)

Status: draft for review. Supersedes v1. Revised after a verification pass that
re-measured the capture and INVERTED the content-source finding (the hook, not the
traces channel, is the full-content source). Every change below is backed by a
byte-level measurement or is an explicit "unverified, needs data" marker. Cline
fields remain PROVISIONAL. Style: no em or en dashes anywhere, per project rule.

## Changelog from v1

1. CONFIRMED: OTel attributes are FLAT keys, not nested under `data.`. Values are
   strings with one measured exception: event.sequence arrives as intValue. So the
   rule is "string on the wire, parse at projection, except event.sequence which is
   already an int." (Shape mismatch 1 and 2; corrected by verification pass.)
2. CORRECTED (verification pass inverted the earlier claim): the HOOK is the full
   content channel, otlp-logs is the truncated one. Measured on one matched Edit
   record: otlp tool_input = 415 chars, hook tool_input = 4646 chars. Hook stdout
   is full (tool_response.stdout = 1834, byte-identical to the trace copy, 22 of
   22). Hooks also have broader coverage: 74 of 75 records carry tool_use_id vs 55
   of 75 for trace tool.output. So hook is primary content, traces are a
   full-fidelity cross-check and fallback, and otlp-logs is NEVER a content source.
   The v1 draft and the first v1.1 draft had this backwards; this is the fix.
3. CONFIRMED: a capture file is NOT a session. hooks.ndjson mixed multiple
   sessions, was still being appended to, and contained a SessionStart with source
   "resume" for a session that had already ended. Session boundaries and
   CaptureCoverage are redefined to handle resume. (Shape mismatch 11.)
4. UNVERIFIED, FLAGGED: the actor model has zero evidence either way. agent_id
   and parent_agent_id appeared nowhere in the one captured session, but that
   session spawned no subagent, so their absence proves nothing. The actor object
   stays, marked unverified, pending a session with a real subagent Task.
5. UNTESTED, FLAGGED: the transcript channel as backfill is unproven.
   transcript_path resolves to a real 2 MB JSONL that was never opened; whether
   it contains the git push output that exists on no other channel is untested.

---

## 1. The one decision this schema is built around (unchanged)

There is exactly ONE atom: the step. Everything smaller is a field on a step;
everything larger is a container that groups steps.

- A single tool call (a command, a file edit, a file read) is a step. The atom.
- An assistant turn is a container of steps.
- A session is a container of turns.

You can point at any level: a session (cost, verdict), a turn (what the model
decided plus everything it did), a single command (full stdout), a single edit
(exact diff). Three of those are containers, one is the atom.

---

## 2. Three top-level concepts (unchanged)

Agent kind: the tool that produced the session (claude-code, cline, ...). A
property of a session; a badge and filter in the UI, never its own navigation.

Session: one run of one agent against one working directory. See section 3a for
the resume revision.

Actor: the entity within a session that took a step. UNVERIFIED in v1.1; see
section 4.

---

## 3. The session object

```
Session {
  id: string                 // Postrun-assigned. Maps to the agent's own id.
                             // NOTE: does not equal a capture file. One file can
                             // hold many sessions; one session can span files.
  agent: {
    kind: string
    version: string
    format_version: string   // Cline PROVISIONAL: "legacy" vs current store.
  }
  workspace: { root: string, repo: string? }
  segments: SessionSegment[] // NEW in v1.1. A session is now a list of contiguous
                             // run segments, because sessions pause and resume.
                             // Most sessions have exactly one segment.
  actors: Actor[]            // UNVERIFIED, see section 4
  capture: CaptureCoverage   // now defined per segment, section 6
  totals: {                  // projected from steps across all segments
    cost_usd: number         // parsed from string api_request attrs
    tokens: { input, output, cache_read, cache_creation: number }
    step_counts: { by_type: map<string,int> }
    flags: int
  }
  verdict: Verdict?
}
```

### 3a. Session segments (NEW)

The pressure-test found a SessionStart with source "resume" after the session
had ended. A session is therefore not a single contiguous run and not bounded by
a file. It is a sequence of segments.

```
SessionSegment {
  index: int
  start_reason: string       // "start" | "resume" | "clear" ...
  started_at: timestamp
  ended_at: timestamp?
  source_files: string[]     // which capture files this segment's events came
                             // from (a single segment can be split across
                             // appended files; a single file holds many)
}
```

Steps carry segment_index so the timeline can render "session resumed here"
honestly rather than presenting a resumed session as one unbroken run.

---

## 4. The actor object (UNVERIFIED in v1.1)

RETAINED but explicitly unproven. In the one captured session, no subagent was
spawned and agent_id / parent_agent_id did not appear. This neither confirms nor
refutes the model. The single highest-value missing capture is a Claude Code
session that spawns a subagent (a Task call); until we have one, do not treat the
actor tree as validated.

```
Actor {
  id: string
  parent_id: string?         // null for root
  type: string               // "root" | "subagent"
  label: string?
}
```

Degradation contract stands: Cline emits exactly one root actor. Claude Code is
expected to populate a tree, UNVERIFIED. If a subagent session shows a different
field shape than agent_id/parent_agent_id, this object changes.

---

## 5. The step object (the atom)

```
Step {
  id: string
  session_id: string
  segment_index: int         // NEW: which SessionSegment this step belongs to
  turn_id: string
  actor_id: string           // UNVERIFIED source; defaults to root actor
  seq: int                   // Claude Code: event.sequence, an intValue (not a
                             // string). Gapless 0..625 in otlp-logs (single
                             // session there, 626 of 626). hooks.ndjson is the file
                             // that interleaves sessions, so still filter by
                             // session_id before ordering.
  at: timestamp              // parsed from string attr
  type: string               // "command" | "edit" | "read" | "message" | "other"
  status: string             // "ok" | "failed" | "rejected"
  channels: string[]         // e.g. ["otel","trace","hook"]. See content rule.
  payload: <type-specific>
  flags: Flag[]
}
```

Wire-format note: almost every attribute in otlp-logs.ndjson is a flat string key
with a string value. There is no `data.` prefix. The adapter reads strings and the
projection layer parses types. This applies to cost_usd, tokens, timestamps, exit
codes, and booleans. The one measured exception is event.sequence, which arrives as
an intValue, so seq is NOT parsed from a string.

### Content-source rule (CORRECTED)

The first v1.1 draft inverted the channels. Verified precedence, backed by byte
counts on a matched record:

1. HOOK is the primary content source. Full tool_input (4646 vs otlp 415 on the
   measured record) and full tool_response.stdout (1834, byte-identical to trace)
   live here, with the broadest coverage (74 of 75 records).
2. TRACES are a full-fidelity cross-check and fallback for the ~19 of 75 records
   the hook does not cover.
3. OTLP-LOGS is NEVER a content source: its tool_input is truncated. Use it only
   for ordering (event.sequence), correlation (tool_use_id, prompt.id), cost, and
   tokens.
4. When neither hook nor trace carries the content (e.g. the git push output that
   is on no channel), set output_ref / text_ref to the raw body or transcript
   pointer and mark the step "reference only."
5. Record in `channels` exactly which channels evidenced the step, so a reviewer
   can see when content is a pointer rather than inline.

```
CommandPayload {
  command: string
  stdout: string?            // from the HOOK (tool_response.stdout); trace is the
                             // cross-check/fallback. otlp-logs is never used here.
  stderr: string?
  exit_code: int?            // parsed from string
  cwd: string?
  output_ref: string?        // pointer when side-channeled or missing inline
}
EditPayload {
  path: string
  old_string: string?        // full in the hook; otlp-logs truncates. See rule.
  new_string: string?
  is_full_write: bool
  landed_in_final_state: bool // false marks a dead-end edit (out-of-diff value)
}
ReadPayload { path: string, range: [int,int]? }
MessagePayload { role: string, text: string?, text_ref: string? }
OtherPayload { tool_name: string, raw: object }
```

The "other" escape hatch stands. Watch its volume: if "other" becomes a large
share of steps, the taxonomy needs extending (a v2 input, not a v1 blocker).

---

## 6. Capture coverage (REVISED for resume)

v1 assumed one session per file, which the data refuted. Coverage is now scoped
per session segment, and explicitly records that a channel may cover multiple
sessions or only part of one.

```
CaptureCoverage {
  channels: CaptureChannel[]
}
CaptureChannel {
  name: string               // "otel" | "trace" | "hook" | "transcript" | ...
  segment_index: int         // which segment this coverage window applies to
  active_from: timestamp?
  active_to: timestamp?
  shared_file: bool          // true if the underlying file also holds other
                             // sessions (e.g. hooks.ndjson), so the adapter must
                             // filter by session_id, not by file
  notes: string?             // "registered mid-session", "backfilled", "resumed"
}
```

Known channel-specific gaps (adapter behavior, not schema fields):
- Claude Code: nonzero-exit Bash commands did not reliably produce a hook record;
  transcript is the intended backfill (UNTESTED, finding 5).
- Claude Code: otlp-logs tool_input truncates; the HOOK carries full content and
  traces are the fallback. (Corrected from the first v1.1 draft.)
- Cline: a completed-looking session may be unflushed; storage format drifted
  (flat JSON now "legacy"). PROVISIONAL.

---

## 7. Flags and verdict (unchanged)

```
Flag {
  kind: string               // "dangerous_command" | "dead_end_edit"
                             //  | "rejected" | "failed" | "secret_in_output" ...
  severity: string           // "info" | "warn" | "danger"
  reason: string
}
Verdict { state: string, note: string?, reviewer: string? }
```

Rejection capture remains UNPROVEN: both real sessions ran permissive/auto-approve
and produced no denial. Still owed: one session with a real rejection.

---

## 8. The turn container (unchanged shape, note added)

```
Turn {
  id: string
  session_id: string
  segment_index: int         // NEW: turns belong to a segment
  actor_id: string           // UNVERIFIED source
  index: int
  prompt_id: string?         // Claude Code: prompt.id (flat string attr)
  mode: string?              // Cline plan|act PROVISIONAL; Claude Code n/a.
                             // Not normalized in v1.x; store agent's own string.
  started_at: timestamp
  step_ids: string[]
}
```

---

## 9. Durable vs projected (unchanged)

Durable and immutable: the raw captures on disk, and the normalized step stream
derived from them. Projected: totals, flags, landed_in_final_state, final diffs,
the actor tree rendering, segment stitching. The event stream is the asset; every
view is a projection, never an edit. This is also why unmodeled attributes
(ttft_ms, host.arch) are not defects: the raw capture retains them for any future
projection that needs them.

---

## 10. Open questions, ranked by how load-bearing they are

1. ACTOR MODEL (highest). Zero evidence either way. Needs one Claude Code session
   that spawns a subagent Task. The whole cross-agent actor tree rests on this.
2. SESSION RESUME. Modeled in v1.1 as segments, but the stitching logic (matching
   a resume to its prior segment across a shared file) is untested against a real
   multi-segment session. Needs one real resume captured deliberately.
3. TRANSCRIPT BACKFILL. Unproven. Open the 2 MB transcript JSONL and confirm it
   contains the git push output missing from every other channel. Cheap, do next.
4. REJECTION PATH. Unproven in both specimens (permissive settings). Needs one
   real denial.
5. CLINE CURRENT-FORMAT STORE. Not decoded. Settle with a live fs trace at
   Cline-adapter build time.
6. PROVENANCE AND CONSENT. Cline refused to expose another task's data on consent
   grounds during the spike. "Whose data, who authorized reading it" is a
   candidate first-class concern near redaction; not yet modeled. Consider for
   v1.2.
7. RAW BODY STORAGE COST. Measured 60 MB across 173 files on disk for the captured
   session (the earlier ~120 MB figure was not reproduced). Retention or dedup is a
   storage-design input; the schema must not assume raw bodies are kept forever.
8. TURN.MODE NORMALIZATION deferred to v2 pending more agents.

## 11. What did NOT change, and why (guard against over-correction)

The pressure-test listed several "missing home" attributes (ttft_ms, host.arch,
and similar). These are inventory, not defects: a schema is allowed to not model
things, and section 9 keeps the raw capture for them. The one with real teeth is
the "other"-type volume risk, already covered by the taxonomy-signal note in
section 5. No field was added merely because an attribute existed in the capture.
