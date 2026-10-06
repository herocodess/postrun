/**
 * What the session page says about a session, computed from the steps it
 * already has: a one-line plain summary, the PR summary you can paste, risk
 * flags grouped by kind, the commits the agent made, and per-file changes.
 * Nothing here calls a model or leaves the machine.
 */

import type { Flag, Step } from "@postrun/core/schema";
import type { SessionDetailResponse } from "@postrun/core/server/api";

type Detail = SessionDetailResponse;

export const RISK_LABELS: Record<string, string> = {
  dangerous_command: "Risky commands",
  secret_in_output: "Secrets in output",
  outside_workspace: "Edits outside the project",
  sensitive_read: "Secrets files",
};

/** Risk flags only (not the adapter's own "failed" style flags), with the step they are on. */
export function riskFlagsOf(steps: Step[]): { kind: string; label: string; items: { seq: number; flag: Flag; step: Step }[] }[] {
  const groups = new Map<string, { seq: number; flag: Flag; step: Step }[]>();
  for (const s of steps) {
    for (const f of s.flags) {
      if (!(f.kind in RISK_LABELS)) continue;
      const list = groups.get(f.kind) ?? [];
      list.push({ seq: s.seq, flag: f, step: s });
      groups.set(f.kind, list);
    }
  }
  const order = Object.keys(RISK_LABELS);
  return [...groups.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([kind, items]) => ({ kind, label: RISK_LABELS[kind] ?? kind, items }));
}

export interface Commit {
  seq: number;
  branch: string;
  sha: string;
  message: string;
}

/** Commits read from `git commit` output: "[main 1a2b3c4] Message" (or "(root-commit)"). */
export function commitsOf(steps: Step[]): Commit[] {
  const out: Commit[] = [];
  for (const s of steps) {
    if (s.type !== "command" || s.outcome === "failed") continue;
    const cmd = s.payload.command ?? "";
    if (!/\bgit\b[^\n]*\bcommit\b/.test(cmd)) continue;
    for (const line of (s.payload.stdout ?? "").split("\n")) {
      const m = /^\[([^\s\]]+)(?: \(root-commit\))? ([0-9a-f]{7,})\] (.+)$/.exec(line.trim());
      if (m) out.push({ seq: s.seq, branch: m[1]!, sha: m[2]!, message: m[3]! });
    }
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const short = (p: string, root: string) => (root && p.startsWith(root.replace(/\/+$/, "") + "/") ? p.slice(root.replace(/\/+$/, "").length + 1) : p);

function elapsed(from: string, to?: string): string {
  if (!to) return "";
  const m = Math.round((Date.parse(to) - Date.parse(from)) / 60000);
  if (!Number.isFinite(m) || m < 1) return "under a minute";
  if (m < 60) return plural(m, "minute");
  const h = Math.floor(m / 60);
  return `${plural(h, "hour")}${m % 60 ? ` ${m % 60} min` : ""}`;
}

/** One or two plain sentences: what the agent did, what went wrong, how it ended. */
export function plainSummary(d: Detail): string {
  const { report, summary, steps } = d;
  const c = report.counts;
  const did: string[] = [];
  if (c.files_edited + c.files_created > 0) did.push(`changed ${plural(c.files_edited + c.files_created, "file")}`);
  if (c.commands_run > 0) did.push(`ran ${plural(c.commands_run, "command")}`);
  if (c.files_read > 0) did.push(`read ${plural(c.files_read, "file")}`);
  const time = elapsed(summary.started_at, summary.ended_at);
  let first = did.length ? `The agent ${did.slice(0, -1).join(", ")}${did.length > 1 ? " and " : ""}${did[did.length - 1]}` : "The agent only replied, without touching files or running commands";
  if (time) first += ` in ${time}`;
  first += ".";

  const parts = [first];
  const failedCmds = report.commands.filter((x) => x.failed > 0);
  if (failedCmds.length) {
    const lastStep = [...steps].reverse().find((s) => s.type === "command");
    const endedOk = lastStep && lastStep.outcome !== "failed";
    const names = failedCmds.slice(0, 2).map((x) => `\`${firstLine(x.command, 40)}\``);
    if (failedCmds.length > 2) names.push(`${failedCmds.length - 2} more`);
    const named = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]!;
    parts.push(`${named} failed${endedOk ? ", and the last command passed" : ", and the last command failed too"}.`);
  } else if (c.commands_run > 0) {
    parts.push("No command failed.");
  }
  const risks = riskFlagsOf(steps);
  if (risks.length) parts.push(`Flagged: ${risks.map((r) => r.label.toLowerCase()).join(", ")}.`);
  return parts.join(" ");
}

function firstLine(s: string, max = 100): string {
  const l = (s.split("\n")[0] ?? "").trim();
  return l.length > max ? l.slice(0, max - 1) + "…" : l;
}

/** Markdown to paste into a pull request description. */
export function prSummary(d: Detail): string {
  const { summary, report, steps } = d;
  const root = summary.workspace.root;
  const lines: string[] = [];
  lines.push(`## ${firstLine(summary.title || "Agent session", 90)}`);
  lines.push("");
  lines.push(plainSummary(d));
  lines.push("");
  const changed = report.files.filter((f) => f.created + f.edited > 0);
  if (changed.length) {
    lines.push("### Changes");
    for (const f of changed.slice(0, 25)) lines.push(`- \`${short(f.path, root)}\`${f.created ? " (new)" : ""}${f.failed ? ` (${plural(f.failed, "failed edit")})` : ""}`);
    if (changed.length > 25) lines.push(`- …and ${changed.length - 25} more`);
    lines.push("");
  }
  if (report.commands.length) {
    lines.push("### Commands");
    for (const c of report.commands.slice(0, 12)) lines.push(`- \`${firstLine(c.command, 80)}\`${c.count > 1 ? ` ×${c.count}` : ""}${c.failed ? ` (failed ${c.failed}×)` : ""}`);
    if (report.commands.length > 12) lines.push(`- …and ${report.commands.length - 12} more`);
    lines.push("");
  }
  const commits = commitsOf(steps);
  if (commits.length) {
    lines.push("### Commits");
    for (const c of commits) lines.push(`- \`${c.sha}\` ${c.message}`);
    lines.push("");
  }
  const risks = riskFlagsOf(steps);
  if (risks.length) {
    lines.push("### Worth checking");
    for (const r of risks) for (const it of r.items.slice(0, 5)) lines.push(`- ${it.flag.reason} (step ${it.seq})`);
    lines.push("");
  }
  if (summary.verdict) {
    lines.push(`Reviewed: ${summary.verdict.state === "approved" ? "looks good" : "needs follow-up"}${summary.verdict.note ? `. ${summary.verdict.note}` : ""}`);
    lines.push("");
  }
  const meta = [summary.agent.kind === "cline" ? "Cline" : "Claude Code", summary.git_branch ? `branch \`${summary.git_branch}\`` : "", plural(summary.steps_total, "step"), summary.metrics.api_requests > 0 ? `$${summary.metrics.cost_usd.toFixed(2)}` : ""].filter(Boolean);
  lines.push(`<sub>Recorded with Postrun: ${meta.join(", ")}.</sub>`);
  return lines.join("\n");
}

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** A line diff (longest common subsequence). Large inputs fall back to "all removed, all added". */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  if (a.length * b.length > 250_000) return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))];
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ kind: "del", text: a[i++]! });
    else out.push({ kind: "add", text: b[j++]! });
  }
  while (i < n) out.push({ kind: "del", text: a[i++]! });
  while (j < m) out.push({ kind: "add", text: b[j++]! });
  return out;
}

export interface FileChange {
  path: string;
  rel: string;
  edits: { seq: number; failed: boolean; full: boolean; lines: DiffLine[]; cut: boolean }[];
  added: number;
  removed: number;
}

/** Every edit, grouped by file in the order the files were first changed. */
export function changesByFile(steps: (Step & { truncated?: Record<string, number> })[], root: string): FileChange[] {
  const files = new Map<string, FileChange>();
  for (const s of steps) {
    if (s.type !== "edit") continue;
    const p = s.payload;
    let f = files.get(p.path);
    if (!f) {
      f = { path: p.path, rel: short(p.path, root), edits: [], added: 0, removed: 0 };
      files.set(p.path, f);
    }
    const lines = diffLines(p.old_string ?? "", p.new_string ?? "");
    const failed = s.outcome === "failed";
    if (!failed) {
      f.added += lines.filter((l) => l.kind === "add").length;
      f.removed += lines.filter((l) => l.kind === "del").length;
    }
    f.edits.push({ seq: s.seq, failed, full: p.is_full_write, lines, cut: s.truncated !== undefined });
  }
  return [...files.values()];
}
