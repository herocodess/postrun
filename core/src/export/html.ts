/**
 * Renders an ExportDocument as one self-contained HTML file.
 *
 * - No JavaScript. Steps expand with <details>, so the report works when
 *   emailed, attached, or opened with scripts blocked.
 * - No outside requests: system fonts, inline CSS, no images.
 * - Every captured string is escaped, and a Content-Security-Policy forbids
 *   scripts, frames, forms, and fetches, so even agent output crafted as HTML
 *   cannot run in the reader's browser.
 * - Light or dark follows the reader's setting; prints cleanly.
 */

import type { Step, Turn } from "../schema/index.js";
import type { RedactionReport, SecretKind } from "../redact/redact.js";
import type { ExportDocument } from "./model.js";

// app.postrun.app only hosts uploads carrying this exact policy and the generator tag below
// (apps/app/lib/shares.ts isPostrunReport). Change both together.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

export function renderExportHtml(doc: ExportDocument, redaction: RedactionReport): string {
  const title = doc.title ?? `${doc.agent.kind} session ${doc.session_id}`;
  const end = doc.ended_at ?? doc.last_activity_at;
  const { counts } = doc.report;
  const failedCmds = counts.commands_failed;

  const stats: Array<[string, string, (string | undefined)?]> = [
    ["steps", num(doc.steps.length)],
    ["turns", num(doc.turns.length)],
    ["files touched", num(counts.files_touched)],
    ["commands", num(counts.commands_run), failedCmds ? `${failedCmds} failed` : undefined],
    ["failed steps", num(counts.steps_failed)],
    ["duration", end ? duration(doc.started_at, end) : "n/a"],
  ];
  if (doc.metrics.cost_usd > 0) stats.push(["cost", `$${doc.metrics.cost_usd.toFixed(2)}`, `${num(doc.metrics.api_requests)} requests`]);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="postrun">
<meta name="postrun:agent" content="${esc(doc.agent.kind.replace(/[^a-z0-9-]/gi, "").slice(0, 32))}">
<title>${esc(clip(title, 80))} · postrun report</title>
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="wrap">
  <span class="brand">postrun<span class="dot">.</span></span>
  <span class="kicker">session report</span>
  <span class="spacer"></span>
  <span class="pill">exported ${esc(date(doc.exported_at))}</span>
</div></header>

<main class="wrap">
  <section class="hero">
    <div class="hero-head">
      <span class="badge ${agentClass(doc.agent.kind)}">${esc(doc.agent.kind)}</span>
      <h1>${esc(title)}</h1>
      ${doc.agent.version && doc.agent.version !== "unknown" ? `<span class="ver">v${esc(doc.agent.version)}</span>` : ""}
    </div>
    <div class="stats">
      ${stats.map(([k, v, sub]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v${k === "failed steps" && counts.steps_failed ? " bad" : ""}">${esc(v)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`).join("")}
    </div>
    <dl class="meta">
      <div><dt>workspace</dt><dd class="mono">${esc(doc.workspace.root)}</dd></div>
      ${doc.workspace.repo ? `<div><dt>repo</dt><dd class="mono">${esc(doc.workspace.repo)}</dd></div>` : ""}
      <div><dt>started</dt><dd class="mono">${esc(date(doc.started_at))}</dd></div>
      <div><dt>${doc.ended_at ? "ended" : "last activity"}</dt><dd class="mono">${end ? esc(date(end)) : "n/a"}</dd></div>
      ${doc.metrics.tokens.input + doc.metrics.tokens.output > 0 ? `<div><dt>tokens</dt><dd class="mono">${num(doc.metrics.tokens.input)} in / ${num(doc.metrics.tokens.output)} out</dd></div>` : ""}
    </dl>
  </section>

  ${redactionNote(redaction)}

  <section>
    <h2>Files touched <span class="count">${num(counts.files_touched)} · ${num(counts.files_created)} created, ${num(counts.files_edited)} edited, ${num(counts.files_read)} read</span></h2>
    ${
      doc.report.files.length
        ? `<div class="table"><div class="row head"><span>path</span><span class="r">new</span><span class="r">edit</span><span class="r">read</span></div>${doc.report.files
            .map(
              (f) =>
                `<div class="row${f.failed ? " failed" : ""}"><span class="mono path">${esc(f.path)}</span><span class="r">${f.created || ""}</span><span class="r">${f.edited || ""}</span><span class="r">${f.read || ""}</span></div>`,
            )
            .join("")}</div>`
        : `<p class="empty">No files were created, edited, or read.</p>`
    }
  </section>

  <section>
    <h2>Commands run <span class="count">${num(counts.commands_run)} · ${num(failedCmds)} failed</span></h2>
    ${
      doc.report.commands.length
        ? `<div class="table cmds"><div class="row head"><span>command</span><span class="r">runs</span><span class="r">exit</span></div>${doc.report.commands
            .map(
              (c) =>
                `<div class="row${c.failed ? " failed" : ""}"><span class="mono">${esc(clip(c.command.split("\n")[0] ?? "", 200))}</span><span class="r">${c.count}</span><span class="r${c.failed ? " bad" : ""}">${esc(c.exit_codes.join(", "))}</span></div>`,
            )
            .join("")}</div>`
        : `<p class="empty">No commands were run.</p>`
    }
  </section>

  <section>
    <h2>Timeline <span class="count">${num(doc.turns.length)} turns · ${num(doc.steps.length)} steps · click a step to expand</span></h2>
    ${timeline(doc)}
  </section>
</main>

<footer class="wrap foot">
  Recorded locally with <a href="https://postrun.app">postrun</a>, the flight recorder for coding agents. Exported on purpose ${esc(date(doc.exported_at))}.
</footer>
</body>
</html>
`;
}

// ---- sections ---------------------------------------------------------------

const KIND_LABEL: Record<SecretKind, string> = {
  "private-key": "private key",
  "aws-access-key": "AWS key",
  "github-token": "GitHub token",
  "anthropic-key": "Anthropic key",
  "openai-key": "OpenAI key",
  "stripe-key": "Stripe key",
  "slack-token": "Slack token",
  "google-api-key": "Google API key",
  jwt: "JWT",
  "gitlab-token": "GitLab token",
  "npm-token": "npm token",
  "huggingface-token": "Hugging Face token",
  "sendgrid-key": "SendGrid key",
  "google-oauth-secret": "Google OAuth secret",
  "webhook-url": "webhook URL",
  "url-password": "URL password",
  "auth-header": "auth header",
  cookie: "cookie",
  credential: "credential",
  "high-entropy": "random-looking value",
  email: "email address",
};

function redactionNote(r: RedactionReport): string {
  const parts = (Object.entries(r.counts) as Array<[SecretKind, number]>).map(([k, n]) => `${n} ${KIND_LABEL[k]}${n === 1 ? "" : "s"}`);
  const secrets = parts.length ? `Redacted on export: ${parts.join(", ")}.` : "No secrets detected on export.";
  const paths = r.home_paths ? ` Home directories shown as <span class="mono">~</span>.` : "";
  return `<p class="note${parts.length ? " warn" : ""}">${esc(secrets)}${paths} Masked values appear as <span class="mono">[REDACTED:kind]</span>.</p>`;
}

function timeline(doc: ExportDocument): string {
  const byTurn = new Map<string, Step[]>();
  for (const s of doc.steps) {
    const list = byTurn.get(s.turn_id) ?? [];
    list.push(s);
    byTurn.set(s.turn_id, list);
  }
  const turns = [...doc.turns].sort((a, b) => a.index - b.index);
  const known = new Set(turns.map((t) => t.id));
  const orphans = doc.steps.filter((s) => !known.has(s.turn_id));
  const blocks = turns.map((t) => turnBlock(t, byTurn.get(t.id) ?? []));
  if (orphans.length) blocks.push(turnBlock(undefined, orphans));
  return blocks.length ? blocks.join("") : `<p class="empty">No steps were captured.</p>`;
}

function turnBlock(t: Turn | undefined, steps: Step[]): string {
  const prompt = steps.find((s) => s.type === "message" && s.payload.role === "user");
  const label = prompt?.type === "message" && prompt.payload.text ? clip(prompt.payload.text.split("\n")[0] ?? "", 140) : "";
  const failed = steps.filter((s) => s.outcome === "failed").length;
  return `<div class="turn">
    <div class="turn-head"><span class="tnum">${t ? `turn ${t.index}` : "unassigned"}</span><span class="tlabel">${esc(label)}</span><span class="spacer"></span><span class="tmeta">${steps.length} step${steps.length === 1 ? "" : "s"}${failed ? ` · <span class="bad">${failed} failed</span>` : ""}${t?.mode ? ` · ${esc(t.mode)}` : ""}</span></div>
    ${steps.map(stepBlock).join("")}
  </div>`;
}

function stepBlock(s: Step): string {
  const failed = s.outcome === "failed";
  const ref = s.content_status === "reference_only";
  const outcome = failed ? `<span class="bad">failed${s.error ? ` · ${esc(s.error.type)}` : ""}</span>` : `<span class="ok">${esc(s.outcome)}</span>`;
  const flags = s.flags.length ? `<span class="flagdot" title="${esc(s.flags.map((f) => f.kind).join(", "))}"></span>` : "";
  return `<details class="step${failed ? " failed" : ""}">
    <summary><span class="seq">${s.seq}</span><span class="chip t-${esc(s.type)}">${esc(s.type)}</span><span class="sum mono">${esc(summaryLine(s))}</span>${flags}<span class="out">${ref ? `<span class="ref">not inline</span> · ` : ""}${outcome}</span></summary>
    <div class="body">
      <div class="when mono">${esc(date(s.at, true))}${s.decision !== "n/a" && s.decision !== "unknown" ? ` · ${esc(s.decision)}` : ""}${s.channels.length ? ` · via ${esc(s.channels.join(", "))}` : ""}</div>
      ${stepBody(s)}
      ${s.error ? `<div class="err"><b>${esc(s.error.type)}</b> ${esc(s.error.message)}</div>` : ""}
      ${s.flags.length ? `<ul class="flags">${s.flags.map((f) => `<li class="sev-${esc(f.severity)}"><b>${esc(f.kind.replace(/_/g, " "))}</b> ${esc(f.reason)}</li>`).join("")}</ul>` : ""}
    </div>
  </details>`;
}

function stepBody(s: Step): string {
  const notInline = (what: string, ref?: string) => `<p class="empty">${what} was not captured inline.${ref ? ` Source: <span class="mono">${esc(ref)}</span>` : ""}</p>`;
  switch (s.type) {
    case "command": {
      const p = s.payload;
      const parts: string[] = [];
      if (p.command) parts.push(`<pre class="code cmd"><span class="prompt">$ </span>${esc(p.command)}</pre>`);
      const meta = [p.cwd ? `cwd <span class="mono">${esc(p.cwd)}</span>` : "", p.exit_code !== undefined ? `exit <span class="mono${p.exit_code ? " bad" : ""}">${p.exit_code}</span>` : ""].filter(Boolean);
      if (meta.length) parts.push(`<div class="kv">${meta.join(" · ")}</div>`);
      if (p.stdout) parts.push(`<div class="label">stdout</div><pre class="code scroll">${esc(p.stdout)}</pre>`);
      if (p.stderr) parts.push(`<div class="label">stderr</div><pre class="code scroll stderr">${esc(p.stderr)}</pre>`);
      if (!p.command && !p.stdout && !p.stderr) parts.push(notInline("This command", p.output_ref));
      else if (!p.stdout && !p.stderr && p.output_ref) parts.push(notInline("Output", p.output_ref));
      return parts.join("");
    }
    case "edit": {
      const p = s.payload;
      const head = `<div class="kv">${p.is_full_write ? "wrote" : "edited"} <span class="mono">${esc(p.path)}</span></div>`;
      if (p.old_string === undefined && p.new_string === undefined) return head + notInline("The change");
      return head + diff(p.old_string ?? "", p.new_string ?? "");
    }
    case "read": {
      const p = s.payload;
      return `<div class="kv">read <span class="mono">${esc(p.path)}</span>${p.range ? ` lines <span class="mono">${p.range[0]} to ${p.range[1]}</span>` : ""}</div>`;
    }
    case "message": {
      const p = s.payload;
      if (p.text === undefined) return notInline("This message", p.text_ref);
      return `<div class="label">${esc(p.role)}</div><div class="msg scroll">${esc(p.text)}</div>`;
    }
    case "other": {
      const p = s.payload;
      return `<div class="kv">tool <span class="mono">${esc(p.tool_name)}</span></div>${Object.keys(p.raw ?? {}).length ? `<pre class="code scroll">${esc(JSON.stringify(p.raw, null, 2))}</pre>` : ""}`;
    }
  }
}

function diff(oldText: string, newText: string): string {
  const lines = [
    ...(oldText ? oldText.split("\n").map((l) => `<span class="del">- ${esc(l)}</span>`) : []),
    ...(newText ? newText.split("\n").map((l) => `<span class="add">+ ${esc(l)}</span>`) : []),
  ];
  return `<pre class="code scroll diff">${lines.join("\n")}</pre>`;
}

function summaryLine(s: Step): string {
  switch (s.type) {
    case "command":
      return s.payload.command ? clip(s.payload.command.split("\n")[0] ?? "", 160) : "command (content not inline)";
    case "edit":
      return `${s.payload.is_full_write ? "write" : "edit"} ${s.payload.path}`;
    case "read":
      return s.payload.path + (s.payload.range ? ` [${s.payload.range[0]}-${s.payload.range[1]}]` : "");
    case "message":
      return s.payload.text !== undefined ? `${s.payload.role}: ${clip(s.payload.text.split("\n")[0] ?? "", 160)}` : `${s.payload.role}: (content not inline)`;
    case "other":
      return s.payload.tool_name;
  }
}

// ---- helpers ----------------------------------------------------------------

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function num(n: number): string {
  return n.toLocaleString("en-US");
}

/** UTC, unambiguous for a reader in any timezone. */
function date(iso: string, seconds = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  const base = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return `${base}${seconds ? `:${p(d.getUTCSeconds())}` : ""} UTC`;
}

function duration(from: string, to: string): string {
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return "n/a";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function agentClass(kind: string): string {
  return kind === "claude-code" ? "cc" : kind === "cline" ? "cline" : "other";
}

// ---- styles -----------------------------------------------------------------

const CSS = `
:root{color-scheme:dark light;
--bg:#0B0D12;--s1:#12151C;--s2:#181C25;--s3:#20242F;--border:rgba(255,255,255,.08);--border2:rgba(255,255,255,.14);
--text:#E8EAF0;--text2:#9AA0AE;--muted:#808797;--accent:#FF6A1A;--accent2:#ff8a4c;--accent-dim:rgba(255, 106, 26,.14);
--danger:#F0616D;--danger-bg:rgba(240,97,109,.10);--warn:#E5C04F;--warn-bg:rgba(229,192,79,.10);--ok:#3FCF8E;
--cc-bg:rgba(255, 106, 26,.16);--cc-fg:#ffb38a;--cline-bg:rgba(94,234,212,.14);--cline-fg:#5EEAD4;--other-bg:rgba(148,163,184,.14);--other-fg:#c3cbd9;
--add:#3FCF8E;--add-bg:rgba(63,207,142,.08);--del:#F0616D;--del-bg:rgba(240,97,109,.08);
--mono:ui-monospace,SFMono-Regular,"JetBrains Mono",Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif}
@media (prefers-color-scheme:light){:root{--bg:#FAFAFB;--s1:#FFFFFF;--s2:#F3F4F6;--s3:#E5E7EB;--border:rgba(0,0,0,.09);--border2:rgba(0,0,0,.16);
--text:#111827;--text2:#4B5563;--muted:#6B7280;--accent:#C2410C;--accent2:#C2410C;--accent-dim:rgba(194, 65, 12,.10);
--danger:#DC2626;--danger-bg:rgba(220,38,38,.07);--warn:#A16207;--warn-bg:rgba(161,98,7,.08);--ok:#15803D;
--cc-bg:rgba(194, 65, 12,.12);--cc-fg:#9A3412;--cline-bg:rgba(20,184,166,.14);--cline-fg:#0F766E;--other-bg:rgba(100,116,139,.14);--other-fg:#334155;
--add:#15803D;--add-bg:rgba(22,163,74,.08);--del:#B91C1C;--del-bg:rgba(220,38,38,.07)}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.mono,code,pre{font-family:var(--mono)}
a{color:var(--accent2)}
.top{border-bottom:1px solid var(--border);position:sticky;top:0;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);z-index:2}
.top .wrap{display:flex;align-items:center;gap:12px;height:56px}
.brand{font-weight:700;font-size:16px;letter-spacing:-.01em}.brand .dot{color:var(--accent)}
.kicker{color:var(--text2);font-size:13px}
.spacer{flex:1}
.pill{font:11px var(--mono);color:var(--text2);background:var(--s2);border:1px solid var(--border);padding:4px 10px;border-radius:999px}
.hero{margin:28px 0 18px;background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:22px}
.hero-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.hero h1{font-size:19px;line-height:1.35;margin:0;flex:1;min-width:0;letter-spacing:-.01em}
.ver{font:12px var(--mono);color:var(--muted)}
.badge{font:600 11px var(--mono);padding:4px 9px;border-radius:7px}
.badge.cc{background:var(--cc-bg);color:var(--cc-fg)}.badge.cline{background:var(--cline-bg);color:var(--cline-fg)}.badge.other{background:var(--other-bg);color:var(--other-fg)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));margin-top:18px;border:1px solid var(--border);border-radius:10px;overflow:hidden}
.stat{padding:12px 14px;border-right:1px solid var(--border);margin-right:-1px}
.stat .k{font-size:12px;color:var(--text2)}.stat .v{font:500 18px var(--mono);margin-top:2px}.stat .sub{font-size:11px;color:var(--muted)}
.meta{display:flex;flex-wrap:wrap;gap:6px 24px;margin:16px 0 0;font-size:13px}
.meta div{display:flex;gap:6px}.meta dt{color:var(--text2)}.meta dd{margin:0;word-break:break-all}
.note{margin:0 0 26px;padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:var(--s1);color:var(--text2);font-size:13px}
.note.warn{border-color:color-mix(in srgb,var(--warn) 35%,transparent);background:var(--warn-bg);color:var(--text)}
section{margin:0 0 30px}
h2{font-size:16px;margin:0 0 10px;letter-spacing:-.01em}h2 .count{font-weight:400;font-size:13px;color:var(--text2);margin-left:8px}
.empty{color:var(--text2);margin:6px 0}
.table{border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--s1)}
.row{display:grid;grid-template-columns:1fr 70px 70px 70px;gap:12px;padding:9px 14px;border-top:1px solid var(--border);align-items:center;font-size:13px}
.cmds .row{grid-template-columns:1fr 60px 70px}
.row.head{border-top:0;color:var(--text2);font-size:12px;background:var(--s2)}
.row .r{text-align:right;font-family:var(--mono)}
.row.failed{background:var(--danger-bg)}
.path{word-break:break-all}
.turn{border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--s1);margin-bottom:12px}
.turn-head{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--s2);border-bottom:1px solid var(--border);font-size:13px}
.tnum{font:12px var(--mono);color:var(--accent2);background:var(--accent-dim);padding:3px 8px;border-radius:6px;white-space:nowrap}
.tlabel{color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tmeta{color:var(--muted);font-size:12px;white-space:nowrap}
.step{border-top:1px solid var(--border)}.turn-head+.step{border-top:0}
.step summary{display:grid;grid-template-columns:44px 84px 1fr auto auto;gap:10px;align-items:center;padding:8px 14px;cursor:pointer;list-style:none;font-size:13px}
.step summary::-webkit-details-marker{display:none}
.step summary:hover{background:var(--s2)}
.step[open] summary{background:var(--s2)}
.step.failed summary{background:var(--danger-bg)}
.seq{font:12px var(--mono);color:var(--muted)}
.chip{font:11px var(--mono);padding:2px 8px;border-radius:6px;background:var(--s3);color:var(--text2);text-align:center}
.chip.t-command{color:var(--cline-fg);background:var(--cline-bg)}.chip.t-edit{color:var(--cc-fg);background:var(--cc-bg)}
.sum{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.out{font-size:12px;white-space:nowrap}
.ok{color:var(--ok)}.bad{color:var(--danger)}.ref{color:var(--warn)}
.flagdot{width:7px;height:7px;border-radius:50%;background:var(--warn)}
.body{padding:4px 14px 14px 68px}
.when{font-size:11px;color:var(--muted);margin:4px 0 8px}
.kv{font-size:13px;color:var(--text2);margin:6px 0}
.label{font:11px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 4px}
.code{margin:0;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.scroll{max-height:420px;overflow:auto}
.cmd .prompt{color:var(--muted);user-select:none}
.stderr{border-color:color-mix(in srgb,var(--danger) 30%,transparent)}
.diff .add{display:block;color:var(--add);background:var(--add-bg)}.diff .del{display:block;color:var(--del);background:var(--del-bg)}
.msg{white-space:pre-wrap;word-break:break-word;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px}
.err{margin-top:10px;padding:8px 12px;border-radius:8px;background:var(--danger-bg);color:var(--text);font-size:13px}.err b{color:var(--danger);font-family:var(--mono);font-weight:500;margin-right:6px}
.flags{list-style:none;padding:0;margin:10px 0 0;font-size:12px;color:var(--text2)}.flags b{font-weight:500;margin-right:6px}.flags .sev-warn b{color:var(--warn)}.flags .sev-danger b{color:var(--danger)}
.foot{color:var(--muted);font-size:12px;text-align:center;padding:10px 20px 40px}
@media (max-width:720px){.kicker{display:none}.pill{white-space:nowrap}.hero{padding:16px}.step summary{grid-template-columns:30px 1fr auto;padding:8px 12px}.step summary .chip,.step summary .flagdot{display:none}.body{padding-left:12px}.row{grid-template-columns:1fr 36px 36px 36px;gap:6px;padding:9px 12px}.cmds .row{grid-template-columns:1fr 36px 44px}.turn-head .tlabel{display:none}}
@media print{.top{position:static}.step summary{break-inside:avoid}details.step:not([open]) .body{display:none}.scroll{max-height:none}}
`;
