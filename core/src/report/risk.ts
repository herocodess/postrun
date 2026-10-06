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

/**
 * Bumped whenever the rules change: the store recomputes the flags of sessions already stored
 * (in small batches) the next time it opens, so old sessions follow the new rules too.
 */
export const RISK_RULES_VERSION = 2;

/** The kind every risk flag carries, so the store can tell its own flags from an adapter's. */
export const RISK_KINDS = new Set(["dangerous_command", "secret_in_output", "outside_workspace", "sensitive_read"]);

// ---- reading a command line ---------------------------------------------------------------------
// Rules look at commands as a shell would split them, not at raw text: words inside quotes are
// arguments (echo 'use sudo' runs echo, not sudo), and commands inside $(…), <(…) and `…` are read
// as commands too (bash <(curl …) downloads and runs).

interface Word {
  text: string;
  /** Any part of the word was quoted. */
  quoted: boolean;
}
type Simple = Word[];
/** Simple commands joined by pipes. */
type Pipeline = Simple[];

/** Split a command line into pipelines of simple commands. Nested $(…), <(…) and `…` are collected separately. */
function parseShell(line: string, nested: string[] = []): Pipeline[] {
  const pipelines: Pipeline[] = [];
  let pipeline: Pipeline = [];
  let simple: Simple = [];
  let word = "";
  let quoted = false;
  let inWord = false;
  const endWord = () => {
    if (inWord) simple.push({ text: word, quoted });
    word = "";
    quoted = false;
    inWord = false;
  };
  const endSimple = () => {
    endWord();
    if (simple.length) pipeline.push(simple);
    simple = [];
  };
  const endPipeline = () => {
    endSimple();
    if (pipeline.length) pipelines.push(pipeline);
    pipeline = [];
  };
  /** Read a balanced (…) starting after the opening paren; returns the inner text and the index after it. */
  const balanced = (from: number): [string, number] => {
    let depth = 1;
    let j = from;
    let q: string | undefined;
    for (; j < line.length; j++) {
      const c = line[j]!;
      if (q) {
        if (c === q) q = undefined;
        else if (c === "\\" && q === '"') j++;
        continue;
      }
      if (c === "'" || c === '"') q = c;
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) break;
    }
    return [line.slice(from, j), j + 1];
  };
  for (let i = 0; i < line.length; ) {
    const c = line[i]!;
    if (c === "\\" && i + 1 < line.length) {
      word += line[i + 1];
      inWord = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      const j = line.indexOf("'", i + 1);
      word += line.slice(i + 1, j < 0 ? line.length : j);
      quoted = inWord = true;
      i = j < 0 ? line.length : j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let text = "";
      for (; j < line.length && line[j] !== '"'; j++) {
        if (line[j] === "\\" && j + 1 < line.length) text += line[++j];
        else if (line[j] === "$" && line[j + 1] === "(") {
          const [inner, next] = balanced(j + 2);
          nested.push(inner);
          text += `$(${inner})`;
          j = next - 1;
        } else text += line[j];
      }
      word += text;
      quoted = inWord = true;
      i = j + 1;
      continue;
    }
    if ((c === "$" || c === "<" || c === ">") && line[i + 1] === "(") {
      const [inner, next] = balanced(i + 2);
      nested.push(inner);
      word += `${c}(${inner})`;
      inWord = true;
      i = next;
      continue;
    }
    if (c === "`") {
      const j = line.indexOf("`", i + 1);
      const inner = line.slice(i + 1, j < 0 ? line.length : j);
      nested.push(inner);
      word += "`" + inner + "`";
      inWord = true;
      i = j < 0 ? line.length : j + 1;
      continue;
    }
    if ((c === "(" || c === ")") && !inWord) {
      // A subshell or group: (rm -rf /), $(…) is handled above.
      endPipeline();
      i++;
      continue;
    }
    if (c === "#" && !inWord) {
      const j = line.indexOf("\n", i);
      i = j < 0 ? line.length : j;
      continue;
    }
    if (c === "|" && line[i + 1] !== "|") {
      endSimple();
      i += line[i + 1] === "&" ? 2 : 1;
      continue;
    }
    if (c === ";" || c === "\n" || (c === "&" && line[i + 1] === "&") || (c === "|" && line[i + 1] === "|") || c === "&") {
      endPipeline();
      i += (c === "&" && line[i + 1] === "&") || (c === "|" && line[i + 1] === "|") ? 2 : 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      endWord();
      i++;
      continue;
    }
    word += c;
    inWord = true;
    i++;
  }
  endPipeline();
  return pipelines;
}

/** Every pipeline in a command line, including the ones inside $(…), <(…) and `…`, at any depth. */
function allPipelines(line: string): { pipelines: Pipeline[]; nested: string[] } {
  const out: Pipeline[] = [];
  const nestedAll: string[] = [];
  const queue = [line];
  for (let n = 0; queue.length && n < 50; n++) {
    const nested: string[] = [];
    out.push(...parseShell(queue.shift()!, nested));
    nestedAll.push(...nested);
    queue.push(...nested);
  }
  return { pipelines: out, nested: nestedAll };
}

/**
 * Words that only set up how the real command runs; the command is the word after them. For each,
 * the options that take a value (so the value is not mistaken for the command), and how many plain
 * words come before the command (timeout 10 rm …).
 */
const PREFIX: Record<string, { valued: RegExp; leading?: number }> = {
  sudo: { valued: /^-[ugpCDhrt]$/ },
  doas: { valued: /^-[uC]$/ },
  time: { valued: /^-[fo]$/ },
  nohup: { valued: /^$/ },
  nice: { valued: /^-n$/ },
  ionice: { valued: /^-[cnp]$/ },
  command: { valued: /^$/ },
  exec: { valued: /^-a$/ },
  builtin: { valued: /^$/ },
  env: { valued: /^-[uSC]$/ },
  xargs: { valued: /^-[IinPLdsEa]$/ },
  timeout: { valued: /^-[sk]$/, leading: 1 },
  watch: { valued: /^-[nd]$/ },
  stdbuf: { valued: /^-[ioe]$/ },
  busybox: { valued: /^$/ },
  caffeinate: { valued: /^-[wt]$/ },
  unbuffer: { valued: /^$/ },
};
/** Shell words that start or join compound commands: if …; then rm …; fi. Skipped to reach the command. */
const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "!", "{", "}", "case", "esac", "in"]);
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The command name (basename) and its arguments, after env assignments, keywords and prefixes such as sudo. */
function commandOf(simple: Simple): { name: string; args: string[]; elevated: boolean } | undefined {
  let i = 0;
  let elevated = false;
  for (; i < simple.length; i++) {
    const w = simple[i]!;
    if (w.quoted) break;
    if (ASSIGN.test(w.text) || KEYWORDS.has(w.text)) continue;
    const prefix = PREFIX[w.text];
    if (prefix) {
      if (w.text === "sudo" || w.text === "doas") elevated = true;
      // The prefix's own options (sudo -u bob, xargs -I {}, timeout -s KILL), then its plain words (timeout 10).
      while (i + 1 < simple.length && simple[i + 1]!.text.startsWith("-") && simple[i + 1]!.text !== "-") {
        i++;
        if (prefix.valued.test(simple[i]!.text)) i++;
      }
      i += prefix.leading ?? 0;
      continue;
    }
    break;
  }
  const w = simple[i];
  if (!w) return elevated ? { name: "", args: [], elevated } : undefined;
  return { name: w.text.split("/").pop() ?? w.text, args: simple.slice(i + 1).map((x) => x.text), elevated };
}

/** Short flags (-rf, -Rf, -f), long flags (--force) and separate ones (-r -f), as a set of letters and names. */
function flagsOf(args: string[]): Set<string> {
  const out = new Set<string>();
  for (const a of args) {
    if (a === "--") break;
    if (a.startsWith("--")) out.add(a.slice(2).split("=")[0]!);
    else if (a.startsWith("-") && a.length > 1) for (const ch of a.slice(1)) out.add(ch);
  }
  return out;
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const INTERPRETERS = new Set([...SHELLS, "python", "python3", "node", "perl", "ruby", "php"]);
const DOWNLOADERS = new Set(["curl", "wget"]);
/** Folders that are rebuilt from source: deleting them is routine. */
const BUILD_OUTPUT = /^(?:\.\/)?(?:node_modules|dist|build|out|\.next|\.nuxt|\.turbo|\.cache|coverage|target|\.parcel-cache|\.svelte-kit|__pycache__|\.pytest_cache|tmp)\/?$/;
const SQL_CLIENTS = new Set(["psql", "mysql", "mariadb", "sqlite3", "sqlcmd", "cockroach", "duckdb"]);
const DESTRUCTIVE_SQL = /\b(?:drop\s+(?:table|database|schema)|truncate\s+(?:table\s+)?\w)/i;
const READERS = new Set(["cat", "less", "more", "head", "tail", "bat", "nl", "strings", "xxd", "od", "base64", "source", "."]);

/** Global options of git that take a value: git -C dir push, git -c k=v push. */
function gitSubcommand(args: string[]): { sub: string; rest: string[] } | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-C" || a === "-c" || a === "--git-dir" || a === "--work-tree" || a === "--namespace") {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    return { sub: a, rest: args.slice(i + 1) };
  }
  return undefined;
}

interface Hit {
  reason: string;
  severity: Flag["severity"];
}

/** Arguments that are themselves a command line: bash -c '…', eval …, su -c '…', ssh host '…', find -exec … ;. */
function innerCommands(name: string, args: string[]): string[] {
  const out: string[] = [];
  if ((SHELLS.has(name) || name === "su") && args.includes("-c")) {
    const s = args[args.indexOf("-c") + 1];
    if (s) out.push(s);
  } else if (SHELLS.has(name)) {
    // bash -lc '…', sh -ec '…': the script is the first word after a flag group ending in c.
    const at = args.findIndex((a) => /^-[a-z]*c$/.test(a));
    if (at >= 0 && args[at + 1]) out.push(args[at + 1]!);
  }
  if (name === "eval") out.push(args.join(" "));
  if (name === "ssh") {
    let i = 0;
    for (; i < args.length; i++) {
      const a = args[i]!;
      if (/^-[bcDEeFIiJLlmOopQRSWw]$/.test(a)) i++;
      else if (!a.startsWith("-")) break;
    }
    if (i + 1 < args.length) out.push(args.slice(i + 1).join(" "));
  }
  if (name === "find") {
    for (let i = 0; i < args.length; i++) {
      if (!/^-(?:exec|execdir|ok|okdir)$/.test(args[i]!)) continue;
      const words: string[] = [];
      for (i++; i < args.length && args[i] !== ";" && args[i] !== "+"; i++) words.push(args[i]!);
      if (words.length) out.push(words.join(" "));
    }
  }
  return out;
}

function commandFlags(line: string, depth = 0): Hit[] {
  const hits: Hit[] = [];
  const add = (reason: string, severity: Flag["severity"]) => {
    if (!hits.some((h) => h.reason === reason)) hits.push({ reason, severity });
  };
  const { pipelines, nested } = allPipelines(line);
  for (const pipeline of pipelines) {
    const cmds = pipeline.map(commandOf);
    cmds.forEach((c, idx) => {
      if (!c) return;
      if (c.elevated) add("runs a command as the administrator (sudo)", "warn");
      const { name, args } = c;
      const flags = flagsOf(args);
      const operands = args.filter((a) => !a.startsWith("-"));

      // Commands carried as arguments are read as commands too, a few levels deep.
      if (depth < 4) for (const inner of innerCommands(name, args)) for (const h of commandFlags(inner, depth + 1)) add(h.reason, h.severity);

      if (name === "find" && args.includes("-delete")) {
        const root = args.find((a) => !a.startsWith("-"));
        add("deletes the files find matched (find -delete)", root === "/" || root === "~" || root === "$HOME" ? "danger" : "warn");
      }

      if (name === "rm" && (flags.has("r") || flags.has("R") || flags.has("recursive")) && (flags.has("f") || flags.has("force"))) {
        if (operands.length > 0 && operands.every((o) => BUILD_OUTPUT.test(o))) add("deletes build output recursively (rm -rf)", "info");
        else add("deletes files recursively and without asking (rm -rf)", "danger");
      }

      if (name === "git") {
        const g = gitSubcommand(args);
        if (g?.sub === "push") {
          const gf = flagsOf(g.rest);
          if (gf.has("force") || gf.has("f") || gf.has("mirror") || g.rest.some((a) => /^\+/.test(a))) add("force-pushes, which can overwrite history on the remote", "danger");
          else if ([...gf].some((f) => f.startsWith("force-with-lease") || f === "force-if-includes")) add("force-pushes with a safety check (--force-with-lease)", "warn");
        }
        if (g?.sub === "reset" && g.rest.includes("--hard")) add("throws away uncommitted work (git reset --hard)", "warn");
        if (g?.sub === "clean" && (flagsOf(g.rest).has("f") || flagsOf(g.rest).has("force"))) add("deletes untracked files (git clean -f)", "warn");
      }

      // A download piped into an interpreter, or a shell running a downloaded script.
      if (INTERPRETERS.has(name) && idx > 0 && cmds.slice(0, idx).some((p) => p && DOWNLOADERS.has(p.name))) add("downloads a script and runs it straight away", "danger");
      if (SHELLS.has(name) && args.some((a) => /^[<$]\(\s*(?:curl|wget)\b/.test(a) || (/\b(?:curl|wget)\b/.test(a) && /^\$\(|`/.test(a)))) add("downloads a script and runs it straight away", "danger");
      if (SHELLS.has(name) && flags.has("c") && args.some((a) => /\$\(\s*(?:curl|wget)\b|`\s*(?:curl|wget)\b/.test(a))) add("downloads a script and runs it straight away", "danger");

      if (name === "chmod" && args.some((a) => /^0?777$|^(?:a|o|ugo)\+[rwx]*w/.test(a))) add("makes files writable by everyone (chmod 777)", "warn");

      if (SQL_CLIENTS.has(name) && args.some((a) => DESTRUCTIVE_SQL.test(a))) add("drops or empties a database table", "danger");
      if (name === "dropdb") add("resets or deletes a database", "danger");
      if (name === "prisma" && args[0] === "migrate" && args[1] === "reset") add("resets or deletes a database", "danger");
      if ((name === "rails" || name === "rake") && args.some((a) => /^db:(?:drop|reset)$/.test(a))) add("resets or deletes a database", "danger");

      if (["npm", "pnpm", "yarn", "bun"].includes(name) && args.includes("publish") && !flags.has("dry-run")) add("publishes a package", "warn");

      if (READERS.has(name) && operands.some((o) => SENSITIVE_PATH.test(o.replace(/^~\//, "/")) || /(?:^|\/)\.(?:aws|ssh|kube|docker|gnupg)\//.test(o))) {
        add("reads a secrets file (.env, keys or cloud credentials)", "warn");
      }
      if ((name === "printenv" && args.length === 0) || (name === "env" && args.length === 0) || (name === "export" && flags.has("p")) || (name === "set" && args.length === 0)) {
        add("prints the environment, which often holds secrets", "warn");
      }
    });
  }
  void nested;
  return hits;
}

/**
 * Files that usually hold secrets. Key files only with a key-like name (server.key, private.key),
 * not anything ending in .key (keyboard.key, a Keynote file).
 */
const SENSITIVE_PATH =
  /(^|\/)(\.env(\.[\w.-]+)?|\.envrc|\.dev\.vars|id_rsa|id_ed25519|id_ecdsa|id_dsa|[\w.-]+\.pem|(?:private|server|client|tls|ssl|signing|secret)[\w.-]*\.key|\.npmrc|\.pypirc|credentials(\.json)?|\.netrc|\.git-credentials|[\w.-]*\.tfstate(\.backup)?|kubeconfig|\.kube\/config|\.docker\/config\.json|\.ssh\/config)$/;

/** Redaction kinds that are personal or merely random-looking: masked on export, but not a risk flag. */
const NOT_A_RISK = new Set(["email", "high-entropy"]);

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
    if (cmd) for (const h of commandFlags(cmd.slice(0, 20_000))) out.push({ kind: "dangerous_command", severity: h.severity, reason: h.reason });
    const printed = `${step.payload.stdout ?? ""}\n${step.payload.stderr ?? ""}`.slice(0, 200_000);
    if (printed.trim()) {
      const red = createRedactor();
      red.string(printed, "output");
      const kinds = [...new Set(red.report().findings.map((f) => f.kind))].filter((k) => !NOT_A_RISK.has(k));
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
