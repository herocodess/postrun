# Cline adapter

Reads a Cline 4.1.x session from its current-format store and emits v1.2 `Step[]`, `Turn[]`, and `Actor[]`. Read only.

## Where sessions live

```
~/.cline/data/sessions/<id>/<id>.messages.json   conversation, one JSON document (Anthropic Messages shape + Cline fields)
~/.cline/data/sessions/<id>/<id>.json            metadata: cwd, model, checkpoints, totals
~/.cline/data/db/sessions.db                     SQLite index (one row per session, has subagent columns)
~/.cline/data/globalState.json                   autoApprovalSettings
```

The VS Code `globalStorage/saoudrizwan.claude-dev/tasks/<id>/` directories are the legacy format and are not read.

## Mapping

| Cline | step |
| --- | --- |
| user text block `<user_input mode="act|plan">` | `message` role user; opens a new `Turn` with `mode` set to the agent's own string |
| assistant text block | `message` role assistant |
| assistant thinking block | `message` role "thinking" (PROVISIONAL, v1.2 has no thinking concept) |
| `run_commands` item | `command`; `[Command exited with code N]` parsed into exit_code and stripped from stdout |
| `run_commands` item, "proceed while running" | `command`, `content_status: "reference_only"`, `output_ref` = Cline's temp log. Partial "Output so far" text is kept in stdout when present |
| `read_files` item | `read` |
| `editor` | `edit`; no `old_text` means create, so `is_full_write: true` |
| `search_codebase`, `fetch_web_content` items | `other` with the item input and result in raw |
| any other block type | `other` `block:<type>` |

Batched tools yield one step per item with ids `<tool_use_id>#<i>`.

`decision` is PROVISIONAL: Cline records no per-call approval. It is derived from `autoApprovalSettings` in globalState.json (auto for categories that were auto-approved, accepted for categories that were not, since the tool ran). `stats.decision_source` says whether settings were available.

`outcome` is from `success: false` or `is_error`; `error.type` is always `cline_tool_error` because Cline has no error taxonomy. `structured_patch` is never set: Cline returns a diff snippet string, not a structured patch.

Segments are PROVISIONAL, from checkpoint `runCount` in the metadata. Ordering is by array index; message `ts` is not monotonic in the real capture.

## Usage

```bash
pnpm -s adapter:cline 1788568010939_qp82o > steps.json          # by id
pnpm -s adapter:cline ~/.cline/data/sessions/<id> > steps.json  # by directory or messages file
pnpm serve --agent cline --captures 1788568010939_qp82o          # same timeline UI
```
