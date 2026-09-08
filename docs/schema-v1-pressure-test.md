Schema v1 pressure test against real Claude Code capture

Summary: the schema's core shape (step as atom, turn and session as containers) survives contact with the real data, and its two most specific empirical claims (gapless event.sequence 0..625, $0.9984 across 86 api_request events) both reproduce exactly; the significant failures are that the actor model has no observable source in this capture, that "otel" is treated as one channel when otlp-logs and otlp-traces carry materially different content, and that the stated stdout source is only one of two real sources.

Capture inventory (read only)

* ~/.postrun/captures/otlp-logs.ndjson, 1085810 bytes, 122 lines, 626 log records after unwrapping.
* ~/.postrun/captures/otlp-traces.ndjson, 712120 bytes, 115 lines, 318 spans.
* ~/.postrun/captures/otlp-metrics.ndjson, 514565 bytes, 91 lines.
* ~/.postrun/captures/hooks.ndjson, 1568081 bytes, 217 lines, 225 records parsed, 2 unparseable.
* ~/.postrun/captures/hooks.ndjson.presession, 52468 bytes, 21 lines.
* ~/.postrun/captures/api-bodies/, 173 files, 60 MB.

No session-capture.json and no timeline*.json exist anywhere under ~/Kraftyn or ~/.postrun. The schema header cites "session-capture.json, 626 events" as its specimen. The 626 count reproduces exactly from otlp-logs.ndjson, so the specimen is almost certainly this capture set, but the named file is not on disk.

Every NDJSON line is a wrapper object, not raw OTLP. Real shape is {"received_at": ..., "payload": {...}} for the otlp files and {"received_at": ..., "channel": "hook", "payload": {...}} for hooks.ndjson. The OTLP document sits one level down under payload.

Section 1. MISSING HOME

Fields present in the real capture with no corresponding field anywhere in the schema.

1. The entire tool.output span event on the traces channel. Span claude_code.tool carries an event named tool.output whose attributes are (bash_command, output), (file_path, diff), or (file_path, content). Evidence: output = '/Users/hero/herodion/dear-ollie/components/memories/new-memory-form.tsx\n...' at length 1834. The schema has no concept of tool content arriving on the traces channel at all.

2. claude_code.tool.blocked_on_user spans, 75 of them, carrying duration_ms. Evidence: durations range from 1 ms to 252740 ms, summing to 476546 ms of wall clock spent waiting on human approval. This is review-relevant time with no home in Step, Turn, or Session.

3. tool_response.structuredPatch and tool_response.originalFile on Edit hook records. Evidence: structuredPatch = [{'oldStart': 8, 'oldLines': 6, 'newStart': 8, 'newLines': 7, 'lines': [...]}], originalFile at length 6288. EditPayload models only old_string and new_string, so the precomputed patch and the full pre-edit file are both dropped.

4. cost_usd_micros on api_request, alongside cost_usd. Evidence: cost_usd = '0.001058' and cost_usd_micros = '1058' on the same record. The integer form is the one safe from float drift when summing, and the schema stores only a single number.

5. LLM request telemetry on api_request and on claude_code.llm_request spans: duration_ms, ttft_ms, speed, stop_reason, attempt, query_source, model, request_id, client_request_id, llm_request.context. Evidence: speed = 'normal', query_source = 'generate_session_title', model = 'claude-haiku-4-5-20251001', ttft_ms present on 86 spans. Session.totals aggregates cost and tokens only, and no step type models an API call, so per-request latency and model identity have nowhere to live.

6. Hook payload fields transcript_path, scratchpad_dir, background_tasks, session_crons, last_assistant_message, stop_hook_active, is_interrupt. Evidence: transcript_path = '/Users/hero/.claude/projects/-Users-hero-herodion-dear-ollie/3ac04cde-89b6-4e88-941b-72293de124c3.jsonl', which exists on disk at 2028836 bytes. The schema names "transcript" as a capture channel but has no field to record where the transcript actually is.

7. Identity and tenancy attributes on all 626 records: user.id, user.email, user.account_uuid, user.account_id, organization.id. Evidence: user.email = 'momohhero2@gmail.com', organization.id = 'ec576230-b059-4075-8f24-1d4e72a49f6c'. Open question 3 in the schema flags provenance and consent as unmodeled; this is the concrete data that question is about, and it is present on every single record.

8. tool_result error detail. Evidence: error_type = 'Error:EISDIR' with error = "EISDIR: illegal operation on a directory, read '/Users/hero/herodion/dear-ollie/app/(app)/'". Step.status collapses to "failed" and no payload carries an error type or message.

9. Environment and version attributes on the OTLP resource: service.name = 'claude-code', service.version = '2.1.261', host.arch = 'arm64', os.type = 'darwin', os.version = '25.0.0', terminal.type = 'vscode'. Session.agent.version has a home for one of these; the rest do not.

10. Event types with no step mapping: api_request_body and api_response_body (173 records carrying body_ref and body_length), hook_execution_start and hook_execution_complete (172), hook_registered (6), mcp_server_connection (6), plugin_loaded (4), feedback_survey (2), permission_mode_changed (1), skill_activated (1). Evidence: body_ref = '/Users/hero/.postrun/captures/api-bodies/a6296262-e27f-4c3e-b712-e6d2b3a725d6.request.json', and all 173 referenced files exist on disk. Under the schema these are either dropped or forced into type "other", which would make "other" the second largest step type in the session.

Section 2. UNFILLABLE

Schema fields the real Claude Code data cannot populate.

1. Step.actor_id, and the whole Actor object and Session.actors registry. Section 2 of the schema asserts "telemetry carries agent_id and parent_agent_id because the main thread spawns subagents". No attribute named agent_id or parent_agent_id exists anywhere in otlp-logs.ndjson, otlp-metrics.ndjson, or otlp-traces.ndjson. The only key matching /agent/ is agent_path_count, which appears 4 times on plugin and config events and is a count of filesystem paths, not an actor identity. Important qualifier: this session spawned no subagents. Observed tool_name values are exactly Read, Bash, Edit, Skill, ToolSearch, and mcp_tool, with no Task tool, so a single root actor is the correct answer here regardless. Whether Claude Code emits agent_id when subagents do exist cannot be determined from this capture. The claim is unsupported by the evidence rather than disproved, but it is currently unsupported.

2. CommandPayload.exit_code. No exit code appears on any channel. The Bash hook tool_response keys are exactly interrupted, isImage, noOutputExpected, stderr, stdout. Failure is signalled only as success = 'false' with error = 'Shell command failed' and error_type = 'ShellError'. The literal exit status is not captured.

3. EditPayload.landed_in_final_state. Correctly described in the schema as computed by the projection layer, but it is not computable from the capture alone. It requires the repository final state, and the workspace (/Users/hero/herodion/dear-ollie) is outside the capture. Noting it because it is the field the product's core value claim rests on.

4. Step.flags and Session.verdict. Both are review-layer constructs by design, not capture data. Listed here only for completeness, not as a defect.

5. Session.workspace.repo. Only cwd is captured, consistently '/Users/hero/herodion/dear-ollie' across all 87 hook records for the session. A git repo name is not present in any channel and would have to be resolved from the filesystem at read time.

6. Rejection status. Step.status defines "rejected" and Flag.kind defines "rejected". Across 75 tool_decision events the decision attribute is 'accept' in 100 percent of cases, split by source as config 57, user_temporary 15, user_permanent 3. The schema already declares this UNPROVEN, and the capture confirms it is still unproven. One adjacent signal does exist: permission_mode_changed with from_mode = 'auto', to_mode = 'default', trigger = 'auto_gate_denied'.

7. All Cline fields (agent.format_version for Cline, Cline seq derivation, Cline stdout, Turn.mode plan/act). Expected gaps. No Cline data exists in this capture set.

Section 3. SHAPE MISMATCH

Schema fields whose real name, shape, or type differs from the draft's assumption.

1. The "data." prefix does not exist. The schema states cost and tokens come from api_request as "data.cost_usd, data.input_tokens, etc.". There is no data object. OTLP attributes are a flat list of {key, value} pairs, and the real keys are cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens. The Session.totals.tokens sub-names (input, output, cache_read, cache_creation) are also shortened forms of the real keys, which is a fine mapping but is a mapping, not the observed names.

2. Every attribute value is a string, not a number. cost_usd = '0.001058', input_tokens = '983', duration_ms = '977', success = 'true', replace_all = 'False'. The sole exception is event.sequence, which is a genuine intValue. The schema types cost_usd as number, tokens as int, and various fields as bool. Every one of those needs a parse step, and the booleans arrive in two different spellings ('true' from OTel, 'False' from the hook channel).

3. "otel" is not one channel. Step.channels lists "otel" as a single value, but otlp-logs and otlp-traces carry different content for the same step. otlp-logs tool_result records carry no output whatsoever, only tool_result_size_bytes. otlp-traces carries the full output on a tool.output span event. Treating these as one channel makes Step.channels unable to express which of the two actually evidenced a given step, which then makes CaptureCoverage unable to describe the real coverage.

4. The stdout source claim is incomplete. CommandPayload says stdout comes "from the PostToolUse hook tool_response, NOT the OTel event (which truncates)". The hook is a correct source, and the OTel logs channel does drop output, so the warning is right about otlp-logs. But otlp-traces carries byte-identical stdout: for all 22 Bash commands where both sources exist, the trace tool.output attribute equals the hook tool_response.stdout exactly, 22 of 22 identical, 0 differing. So there are two full-fidelity sources, not one.

5. The OTel truncation warning is understated for tool_input. The schema flags OTel truncation for output only. tool_input is truncated too, on 17 of 74 joined records. Evidence: one Edit has otel tool_input length 415 against hook tool_input length 4646. CommandPayload.command says "full command string, never truncated", which holds only if the command is taken from the hook or from the trace full_command attribute, never from the otlp-logs tool_input.

6. Turn.mode is real but lives at the wrong granularity. The schema guesses "Claude Code: null or permission mode. PROVISIONAL mapping." permission_mode does exist, on the hook payload, with observed values acceptEdits 192, default 26, auto 1. But it is recorded per hook record, not per turn, and it demonstrably changes within a session: permission_mode_changed fires with from_mode = 'auto' and to_mode = 'default'. Modelling it as one value on the turn cannot represent a mode change mid-turn.

7. Step.status conflates two orthogonal axes. The real data records permission and outcome separately: tool_decision.decision (accept) and tool_result.success (true or false). Nine records are accepted and failed at the same time, for example decision_type = 'accept' with success = 'false' and error_type = 'ShellError'. A single enum of ok, failed, rejected cannot express "approved by config, then failed".

8. The same concept has two different names across channels. tool_result uses decision_type and decision_source; tool_decision uses decision and source; traces use gen_ai.tool.call.id alongside tool_use_id for the same identifier. An adapter has to normalise three spellings.

9. MCP tool names are collapsed in the logs channel but not in traces. otlp-logs reports tool_name = 'mcp_tool' for all 13 MCP calls, with the real identity split into mcp_server.name and mcp_tool.name. otlp-traces reports the full name, for example 'mcp__claude-in-chrome__computer'. OtherPayload.tool_name will get a placeholder if the adapter reads the logs channel.

10. Hook records carry no event timestamp. The only time on a hook record is the wrapper received_at, at whole-second resolution, for example '2026-09-04T23:06:33Z'. OTel carries event.timestamp at millisecond resolution, for example '2026-09-04T23:09:17.599Z'. Step.at will therefore have two different resolutions depending on which channel evidenced the step, and for hook-only steps it is capture receipt time rather than event time.

11. The capture directory is not one session. Session is defined as "one run of one agent against one working directory", but hooks.ndjson interleaves five session ids: 51d262c4 with 105 records, 3ac04cde with 87, 8c044567 with 29, and 13627329 and b3aa3d88 with 2 each. Only 87 records belong to the OTLP session. hooks.ndjson is also still being appended to (mtime 2026-09-05 16:58) while otlp-logs.ndjson stopped at 2026-09-05 00:30. A SessionStart with source = 'resume' also appears for a session id that already had a SessionEnd, so session id is not a single contiguous run.

12. hooks.ndjson is not reliably valid NDJSON. Lines 205 and 206 fail to parse because one record is spliced into the middle of another: the raw text reads '...,"stderr":"","interrupted":fa{"received_at":"2026-09-05T15:58:22Z","channel":"hook",...'. This is an interleaved concurrent append, so 2 of 226 records are unrecoverable. Section 9 calls the raw captures durable and append only; in practice the append is not atomic.

Join verification

tool_use_id does join, and cleanly. Restricting hooks.ndjson to the OTLP session id gives 74 records with a tool_use_id against 75 otlp-logs tool_result records: 74 matched, 1 present in OTel with no hook record, 0 present in hooks with no OTel record. The one unmatched case is discussed below.

PROVISIONAL fields status

* seq, "Claude Code: event.sequence (observed 0..625, no gaps)". CONFIRMED. 626 records, min 0, max 625, 626 distinct values, 0 missing, 0 duplicated.

* Session totals from api_request, "one real session summed to $0.9984 across 86 api_request events". CONFIRMED exactly. 86 api_request events summing to $0.9984. Token totals are input 4379, output 30623, cache_read 6244508, cache_creation 108236. The field path "data.cost_usd" is REFUTED as a path (see shape mismatch 1), but the values and counts are exactly right.

* CommandPayload.stdout from the PostToolUse hook tool_response rather than the OTel event. CONFIRMED as far as it goes, and INCOMPLETE. tool_response.stdout is real and full. The claim that OTel does not have it is true of otlp-logs and false of otlp-traces.

* "Nonzero-exit Bash commands did not reliably produce a hook record, while Read failures fired PostToolUseFailure cleanly". CONFIRMED, precisely. Two Bash commands failed. seq 575 (git add ...) did produce a PostToolUseFailure. seq 604 (command = 'git push origin main') produced no hook record at all, and also no trace tool.output, so its output survives on no captured channel and is recoverable only from the transcript. The Read failure (Error:EISDIR) did fire PostToolUseFailure cleanly. Additional detail the schema does not state: PostToolUseFailure records carry no tool_response at all (it is absent), so for every failed step, stdout is unavailable from the hook channel even when the hook record exists.

* Turn.mode, "Claude Code: null or permission mode. PROVISIONAL mapping." PARTIALLY CONFIRMED and REFUTED on granularity. permission_mode exists with real values, but it is per hook record and changes mid-session. See shape mismatch 6.

* Actor tree, agent_id and parent_agent_id. COULD NOT TEST, and currently unsupported. The attributes do not appear anywhere in this capture, and this session spawned no subagents, so the capture cannot settle whether they would appear in a session that did. This needs one session containing a Task call before the actor model can be called grounded.

* Rejection path and Flag.kind "rejected". COULD NOT TEST. All 75 decisions are 'accept'. Matches the schema's own UNPROVEN note.

* All Cline PROVISIONAL fields (agent.format_version legacy versus current store, Cline seq from array index plus ts, Cline stdout, Cline api_req_started and api_req_finished token field names, Turn.mode plan and act). COULD NOT TEST. No Cline data is present in this capture set. These remain exactly as provisional as before.

* Raw body storage cost, "one 24-minute Claude Code session wrote ~120 MB of raw API bodies". PARTIALLY CONFIRMED. Session duration confirms at 24 minutes (SessionStart 2026-09-04T23:06:33Z to SessionEnd 2026-09-04T23:30:50Z). The api-bodies directory holds 173 files totalling 60 MB on disk, not 120 MB. All 173 body_ref paths resolve to existing files.
