Postrun event schema v1 (draft)

Status: draft for review. Written against real captures from one Claude Code session (session-capture.json, 626 events) and one Cline session (memories photo-upload fix). Claude Code fields are grounded in observed data. Cline fields are marked PROVISIONAL where we have not yet read a real session's structure directly (its current-format store was not decoded in the spike).

Style: no em or en dashes anywhere in this document, per project convention.

1. The one decision this schema is built around

There is exactly ONE atom: the step. Everything smaller is a field on a step; everything larger is a container that groups steps. This is the whole design.

We considered making "tool call", "command", "assistant turn", and "file edit" all peer event types. That collapses: a command IS a tool call, an edit IS a tool call, but a turn CONTAINS many tool calls. Flattening them makes it impossible to tell whether a given event is a turn or one edit inside it, and the timeline cannot render hierarchy. So instead:

* A single tool call (a command, a file edit, a file read) is a step. The atom.
* An assistant turn is a container of steps.
* A session is a container of turns.

You can point at any level: a session (cost, verdict), a turn (what the model decided plus everything it did), a single command (full stdout), a single edit (exact diff). Three of those are containers, one is the atom, and the schema always knows which.

2. Three top-level concepts

These three were missing from the original handoff and must be explicit in v1.

Agent kind. The tool that produced the session: claude-code, cline, and later codex, cursor, and others. It is a property of a session, set by whichever adapter captured it. In the UI it is a badge and a filter, never its own navigation concept (that would drift toward the governance product early).

Session. One run of one agent against one working directory. The unit of review, the way a PR is the unit of code review. One event stream, one cost total, one verdict.

Actor. The entity within a session that took a step. Claude Code sessions are not flat: telemetry carries agent_id and parent_agent_id because the main thread spawns subagents. So every step carries an actor_id, and each session has an actor registry describing the tree. Critical design constraint: the actor tree must degrade to a single root. Cline has no subagents, so its adapter emits everything under one root actor and the model is unchanged. Claude Code populates the full tree. Nothing downstream branches on agent kind; it only walks the tree, which may be a tree of one.

3. The session object

```
Session {
  id: string                 // stable, unique. Postrun-assigned, maps to the
                             // agent's own id (Claude Code session.id; Cline
                             // task id).
  agent: {
    kind: string             // "claude-code" | "cline" | ...
    version: string          // e.g. "claude-code 2.1.x", "cline 4.1.17"
    format_version: string   // adapter-relevant. Cline PROVISIONAL: has at
                             // least "legacy" (flat JSON) and a current store;
                             // the value distinguishes them.
  }
  workspace: {
    root: string             // absolute path of the repo/working dir
    repo: string?            // git repo name if resolvable
  }
  started_at: timestamp
  ended_at: timestamp?       // null while live or if never cleanly closed
  actors: Actor[]            // the actor registry (section 4)
  capture: CaptureCoverage   // per-channel honesty (section 6)
  totals: {                  // projected from steps, not stored raw
    cost_usd: number
    tokens: { input, output, cache_read, cache_creation: number }
    step_counts: { by_type: map<string,int> }
    flags: int
  }
  verdict: Verdict?          // reviewer's conclusion, added in review (section 7)
}

```

Note: totals are a projection over the step stream, never an authored field. In the Claude Code capture, cost_usd and the token fields come from api_request events (data.cost_usd, data.input_tokens, etc.); one real session summed to $0.9984 across 86 api_request events. In Cline they come from ui_messages.json api_req_started/finished entries (PROVISIONAL on exact field names).

4. The actor object

```
Actor {
  id: string                 // actor_id referenced by steps
  parent_id: string?         // null for the root actor
  type: string               // "root" | "subagent"
  label: string?             // e.g. subagent type/name if the agent provides it
}

```

For Cline: exactly one actor, type "root", parent_id null. For Claude Code: a root plus one actor per spawned subagent, parent_id linking the tree. The degradation to a single root is what makes the schema genuinely cross-agent rather than Claude-Code-shaped.

5. The step object (the atom)

Common envelope, then a type-specific payload. The discriminator is `type`.

```
Step {
  id: string                 // stable within the session
  session_id: string
  turn_id: string            // the containing turn (section 8)
  actor_id: string           // who took this step (section 4)
  seq: int                   // total order within the session. Claude Code:
                             // event.sequence (observed 0..625, no gaps).
                             // Cline PROVISIONAL: derive from array index +
                             // per-entry ts.
  at: timestamp
  type: string               // "command" | "edit" | "read" | "message" | "other"
  status: string             // "ok" | "failed" | "rejected"
  channels: string[]         // which capture channels evidenced this step,
                             // e.g. ["otel","hook"] or ["conversation","ui"].
                             // Ties a step back to capture coverage (section 6).
  payload: <type-specific>   // below
  flags: Flag[]              // section 7
}

```

Type-specific payloads:

```
CommandPayload {             // type == "command"
  command: string            // full command string, never truncated
  stdout: string?            // full output. Claude Code: from the PostToolUse
                             // hook tool_response, NOT the OTel event (which
                             // truncates). Cline PROVISIONAL.
  stderr: string?
  exit_code: int?
  cwd: string?
  output_ref: string?        // pointer when output was side-channeled (e.g.
                             // Cline "proceed while running" temp log, or a
                             // Claude Code raw-body file). Presence here is a
                             // capture-completeness signal.
}

EditPayload {                // type == "edit"
  path: string
  old_string: string?        // full prior content of the edited region
  new_string: string?        // full new content
  is_full_write: bool        // write_to_file / Write vs targeted replace
  landed_in_final_state: bool // false marks a dead-end edit: it happened, cost
                             // money, and is invisible in the final diff. This
                             // is the out-of-diff visibility the product exists
                             // to surface. Computed by the projection layer.
}

ReadPayload {                // type == "read"
  path: string
  range: [int,int]?          // line range if applicable
}

MessagePayload {             // type == "message"
  role: string               // "assistant" | "user"
  text: string?              // may be redacted by the pipeline; see redaction
  text_ref: string?          // pointer to full text if stored out of line
}

OtherPayload {               // type == "other"
  tool_name: string          // the raw agent tool name that did not map cleanly
  raw: object                // preserved verbatim so nothing is silently lost
}

```

The "other" type is a deliberate escape hatch. When an agent's tool does not map to command/edit/read/message, we keep it as "other" with the raw tool name and body rather than forcing a bad fit or dropping it. An adapter that produces many "other" steps is a signal the type taxonomy needs extending, which is a v2 input, not a v1 blocker.

6. Capture coverage (the honesty object)

Discovered from a real session where OTel was dead the whole time, hooks were live from mid-session, and some events survived only in the transcript. A flight recorder that does not know when its own recorder was on is lying by omission. So a session records, per channel, when capture was actually active.

```
CaptureCoverage {
  channels: CaptureChannel[]
}
CaptureChannel {
  name: string               // "otel" | "hook" | "transcript" | "conversation"
                             //  | "ui" | ...
  active_from: timestamp?    // null if never active
  active_to: timestamp?
  notes: string?             // e.g. "registered mid-session", "backfilled"
}

```

The review UI must render partial coverage honestly ("recording started mid-session") rather than presenting an incomplete timeline as complete. This is a trust feature, and trust is the entire pitch.

Related known gaps to encode as adapter behavior, not schema fields:

* Claude Code: nonzero-exit Bash commands did not reliably produce a hook record in the observed session, while Read failures fired PostToolUseFailure cleanly. The transcript is the backfill channel for the missing ones.
* Cline: a completed-looking session may not be flushed to its store at the moment the user considers it "done"; capture cannot assume the agent has written. Storage format also drifted (flat JSON now tagged "legacy").

7. Flags and verdict (review layer)

Flags are computed annotations that make the scary and interesting parts jump out. They are not captured; they are derived by the projection/review layer.

```
Flag {
  kind: string               // "dangerous_command" | "dead_end_edit"
                             //  | "rejected" | "failed" | "secret_in_output" ...
  severity: string           // "info" | "warn" | "danger"
  reason: string             // human-readable, shown inline in the timeline
}

```

Examples grounded in real captures: a rejected tool call (REJECT), a dead-end edit (landed_in_final_state == false), a destructive command. Rejection capture is currently UNPROVEN in our specimens because both real sessions ran with permissive/auto-approve settings; v1 still defines it, and we owe one session with a real denial before Gate 1 is fully honest.

```
Verdict {                    // authored during review, optional
  state: string              // "approved" | "concerns" | "rejected"
  note: string?
  reviewer: string?
}

```

8. The turn container

```
Turn {
  id: string
  session_id: string
  actor_id: string           // the actor whose response opened this turn
  index: int                 // 1-based order within the session
  prompt_id: string?         // Claude Code: prompt.id. Groups steps under one
                             // user prompt -> model response cycle.
  mode: string?              // agent-specific. Cline: "plan" | "act" (observed
                             // in task_metadata model_usage). Claude Code: null
                             // or permission mode. PROVISIONAL mapping.
  started_at: timestamp
  step_ids: string[]         // the steps in this turn, in seq order
}

```

The turn is where the plan/act distinction lands. Cline records plan vs act; Claude Code has no direct analog. Rather than invent a cross-agent "mode" enum now, v1 stores the agent's own mode string on the turn and defers a normalized meaning to v2 once we have more agents to generalize from.

9. What is durable vs projected

Durable (write once, immutable, append-only): the raw captures on disk, and the normalized step stream derived from them. Everything else is a projection: totals, flags, landed_in_final_state, the final diff per file, the actor tree rendering. This preserves the handoff principle that the event schema is the asset and every view is a projection over it, never an edit to it.

10. Open questions for review (kill-note honesty)

1. Cline current-format store: structure not yet decoded. Fields marked PROVISIONAL depend on a real read (a live fs trace during a Cline task will settle it at adapter-build time).
2. Rejection path unproven in both specimens (permissive settings). Need one real denial.
3. Provenance and consent: Cline refused to expose another task's data on consent grounds during the spike. "Whose data is this, who authorized reading it" belongs as a first-class concern near redaction, not an afterthought. Not yet modeled above; candidate for v1.1.
4. Raw body storage cost: one 24-minute Claude Code session wrote ~120 MB of raw API bodies. Retention/dedup policy is a storage-design input, not a schema field, but the schema should not assume raw bodies are kept forever.
5. Turn.mode normalization deferred to v2 pending more agents.
