/**
 * Risk flags: steps worth a second look, worked out from what the step did,
 * for every agent alike. They are added when a session is written, merged
 * with any flags the agent's adapter set, and never remove those.
 *
 * Each rule is deliberately narrow: a flag that fires on everything is a flag
 * nobody reads. The reason says what matched, in words.
 */

import { createRedactor } from "../redact/redact.js";
import type { Flag, Step } from "../schema/index.js";

/** The kind every risk flag carries, so the store can tell its own flags from an adapter's. */
export const RISK_KINDS = new Set(["dangerous_command", "secret_in_output", "outside_workspace", "sensitive_read"]);

interface CommandRule {
  test: RegExp;
  reason: string;
  severity: Flag["severity"];
}

const COMMAND_RULES: CommandRule[] = [
  { test: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r\s+-f|-f\s+-r|--recursive\s+--force|--force\s+--recursive)\b/, reason: "deletes files recursively and without asking (rm -rf)", severity: "danger" },
  { test: /\bgit\s+push\b[^\n;&|]*\s(--force(-with-lease)?|-f)\b/, reason: "force-pushes, which can overwrite history on the remote", severity: "danger" },
  { test: /\bgit\s+reset\s+--hard\b/, reason: "throws away uncommitted work (git reset --hard)", severity: "warn" },
  { test: /\bgit\s+clean\s+-[a-zA-Z]*f/, reason: "deletes untracked files (git clean -f)", severity: "warn" },
  { test: /\b(curl|wget)\b[^\n;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, reason: "downloads a script and runs it straight away", severity: "danger" },
  { test: /(^|[;&|]\s*|\s)sudo\s/, reason: "runs a command as the administrator (sudo)", severity: "warn" },
  { test: /\bchmod\s+(-R\s+)?0?777\b/, reason: "makes files writable by everyone (chmod 777)", severity: "warn" },
  { test: /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i, reason: "drops or empties a database table", severity: "danger" },
  { test: /\b(prisma\s+migrate\s+reset|rails\s+db:drop|dropdb)\b/, reason: "resets or deletes a database", severity: "danger" },
  { test: /\bnpm\s+publish\b|\bpnpm\s+publish\b|\byarn\s+npm\s+publish\b/, reason: "publishes a package", severity: "warn" },
  { test: /\b(cat|less|more|head|tail|grep|source|printenv)\b[^\n|;&]*(^|\s|\/)\.env(\.[\w.-]+)?\b|\bprintenv\b\s*$|^\s*env\s*$/m, reason: "reads environment secrets (.env or the environment)", severity: "warn" },
];

const SENSITIVE_PATH = /(^|\/)(\.env(\.[\w.-]+)?|id_rsa|id_ed25519|id_ecdsa|[\w.-]+\.pem|[\w.-]+\.key|\.npmrc|\.pypirc|credentials(\.json)?|\.netrc|\.git-credentials)$/;

function insideWorkspace(path: string, root: string): boolean {
  if (!path.startsWith("/")) return true; // relative paths resolve inside the working folder
  const r = root.replace(/\/+$/, "");
  return path === r || path.startsWith(r + "/");
}

/** Paths an agent may write outside the project without it being unusual. */
const EXPECTED_OUTSIDE = /^\/(tmp|private\/tmp|var\/folders)\//;

/** Risk flags for one step. `workspaceRoot` is the session's working folder. */
export function riskFlags(step: Step, workspaceRoot: string): Flag[] {
  const out: Flag[] = [];
  if (step.type === "command") {
    const cmd = step.payload.command ?? "";
    for (const r of COMMAND_RULES) {
      if (cmd && r.test.test(cmd)) out.push({ kind: "dangerous_command", severity: r.severity, reason: r.reason });
    }
    const printed = `${step.payload.stdout ?? ""}\n${step.payload.stderr ?? ""}`.slice(0, 200_000);
    if (printed.trim()) {
      const red = createRedactor();
      red.string(printed, "output");
      const kinds = [...new Set(red.report().findings.map((f) => f.kind))];
      if (kinds.length > 0) out.push({ kind: "secret_in_output", severity: "danger", reason: `printed what looks like a secret (${kinds.join(", ")})` });
    }
  } else if (step.type === "edit") {
    const p = step.payload.path;
    if (workspaceRoot && !insideWorkspace(p, workspaceRoot) && !EXPECTED_OUTSIDE.test(p)) {
      out.push({ kind: "outside_workspace", severity: "warn", reason: `changed a file outside the project: ${p}` });
    }
    if (SENSITIVE_PATH.test(p)) out.push({ kind: "sensitive_read", severity: "warn", reason: `changed a secrets file: ${p.split("/").pop()}` });
  } else if (step.type === "read") {
    const p = step.payload.path;
    if (SENSITIVE_PATH.test(p)) out.push({ kind: "sensitive_read", severity: "warn", reason: `read a secrets file: ${p.split("/").pop()}` });
  }
  return out;
}

/** The step's flags with risk flags added: the adapter's own flags stay, earlier risk flags are replaced. */
export function withRiskFlags(step: Step, workspaceRoot: string): Step {
  const own = step.flags.filter((f) => !RISK_KINDS.has(f.kind));
  const risk = riskFlags(step, workspaceRoot);
  if (risk.length === 0 && own.length === step.flags.length) return step;
  return { ...step, flags: [...own, ...risk] } as Step;
}
