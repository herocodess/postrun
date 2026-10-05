/**
 * Redaction for anything that leaves this machine (exports now, share links
 * later). Pure: strings in, masked strings and findings out.
 *
 * Three passes per string, in order:
 *   1. Known secret formats (private keys, cloud and SaaS tokens, JWTs).
 *   2. Credential-shaped context: passwords in URLs, Authorization headers,
 *      and NAME=value / "name": "value" / name: value where the name is a
 *      credential word (API_KEY, token, password, client_secret, ...).
 *   3. Home directories: /Users/<name>, /home/<name>, C:\Users\<name> -> ~.
 *
 * Masks look like [REDACTED:<kind>] and are never matched again, so running
 * redaction twice is a no-op. This is a safety net, not a guarantee: the
 * exporter shows every finding so a person reviews before sending.
 */

export type SecretKind =
  | "private-key"
  | "aws-access-key"
  | "github-token"
  | "anthropic-key"
  | "openai-key"
  | "stripe-key"
  | "slack-token"
  | "google-api-key"
  | "jwt"
  | "url-password"
  | "auth-header"
  | "credential";

export interface Finding {
  kind: SecretKind;
  /** Where it was, in reader terms, e.g. "step 12 · command · stdout". */
  location: string;
  /** The surrounding text after masking, so a reviewer can judge it without seeing the secret. */
  context: string;
}

export interface RedactionReport {
  findings: Finding[];
  /** Count by kind, for a one-line summary. */
  counts: Partial<Record<SecretKind, number>>;
  /** Home-directory paths replaced with ~. Counted, not listed: they are many and low risk. */
  home_paths: number;
}

const mask = (kind: SecretKind) => `[REDACTED:${kind}]`;

/** Specific formats first: they are unambiguous, and masking them keeps the generic rules from half-matching. */
const FORMATS: Array<[SecretKind, RegExp]> = [
  ["private-key", /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ["openai-key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
  ["stripe-key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ["slack-token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
];

const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi;
const AUTH_HEADER = /\b(Bearer|Basic|Token)(\s+)([A-Za-z0-9._~+/=-]{16,})/g;

/**
 * NAME <sep> VALUE where NAME may be quoted. The value must be 6+ characters
 * and not already a mask. Whether NAME is a credential is decided in code
 * (isCredentialName), which is easier to keep precise than one regex.
 */
const ASSIGNMENT = /(["']?)\b([A-Za-z_][A-Za-z0-9_.-]{1,80})\1(\s*(?::|=|:=)\s*)(["']?)((?!\[REDACTED)[^\s"'`,;{}()<>]{6,})\4/g;

/** Credential words as whole segments of a snake/kebab/dotted name: API_KEY, db.password, x-auth-token. */
const SEGMENT_WORDS = /(?:^|[_.-])(?:secret|secrets|token|password|passwd|pwd|passphrase|apikey|api[_.-]?key|private[_.-]?key|access[_.-]?key|secret[_.-]?key|credential|credentials|auth|client[_.-]?secret|session[_.-]?key|signing[_.-]?key|webhook[_.-]?secret)(?:$|[_.-])/i;
/** The same words at the end of a camelCase name: apiKey, accessToken, clientSecret, dbPassword. */
const CAMEL_WORDS = /(?:[a-z0-9](?:ApiKey|Token|Secret|Password|Passwd|PrivateKey|AccessKey|Credentials?))$|^(?:apiKey|token|secret|password|passwd|credentials?)$/;

/** Values that are clearly not secrets even under a credential name. */
const NOT_A_SECRET = /^(?:true|false|null|nil|none|undefined|required|optional|string|number|boolean|\*+|x{3,}|changeme|redacted|example|placeholder|your[_-].*|<.*>|\$\{.*\}|\$[A-Z_]+|process\.env\..*|os\.environ.*|env\(.*)$/i;

export function isCredentialName(name: string): boolean {
  return SEGMENT_WORDS.test(name) || CAMEL_WORDS.test(name);
}

const HOME_PATHS: RegExp[] = [/\/(?:Users|home)\/[A-Za-z0-9._-]+(?=\/|\b|$)/g, /\b[A-Za-z]:\\Users\\[^\\\s"']+/g];

export interface Redactor {
  /** Mask one string. location names where it came from, for the findings list. */
  string(value: string, location: string): string;
  report(): RedactionReport;
}

export function createRedactor(): Redactor {
  const findings: Finding[] = [];
  const counts: Partial<Record<SecretKind, number>> = {};
  let homePaths = 0;

  const string = (value: string, location: string): string => {
    const hits: SecretKind[] = [];
    let out = value;
    for (const [kind, re] of FORMATS) {
      out = out.replace(re, () => {
        hits.push(kind);
        return mask(kind);
      });
    }
    out = out.replace(URL_PASSWORD, (_m, head: string, _pw: string, at: string) => {
      hits.push("url-password");
      return head + mask("url-password") + at;
    });
    out = out.replace(AUTH_HEADER, (_m, scheme: string, space: string) => {
      hits.push("auth-header");
      return scheme + space + mask("auth-header");
    });
    out = out.replace(ASSIGNMENT, (m, q1: string, name: string, sep: string, q2: string, val: string) => {
      if (!isCredentialName(name) || NOT_A_SECRET.test(val)) return m;
      hits.push("credential");
      return `${q1}${name}${q1}${sep}${q2}${mask("credential")}${q2}`;
    });
    for (const re of HOME_PATHS) {
      out = out.replace(re, () => {
        homePaths++;
        return "~";
      });
    }
    if (hits.length) {
      for (const kind of hits) counts[kind] = (counts[kind] ?? 0) + 1;
      // One finding per masked value, each with context around its own mask.
      let from = 0;
      for (const kind of hits) {
        const marker = mask(kind);
        const at = out.indexOf(marker, from);
        const idx = at >= 0 ? at : out.indexOf(marker);
        from = idx >= 0 ? idx + marker.length : from;
        findings.push({ kind, location, context: contextAround(out, idx, marker.length) });
      }
    }
    return out;
  };

  return { string, report: () => ({ findings, counts, home_paths: homePaths }) };
}

function contextAround(s: string, idx: number, len: number, pad = 48): string {
  if (idx < 0) return s.slice(0, pad * 2);
  const start = Math.max(0, idx - pad);
  const end = Math.min(s.length, idx + len + pad);
  const text = s.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + text + (end < s.length ? "…" : "");
}

/**
 * Deep-redact every string in a JSON-like value. Keys are kept; only values
 * are masked. location(path) turns the walk path into a reader-facing label.
 */
export function redactDeep<T>(value: T, r: Redactor, location: string): T {
  const walk = (v: unknown, where: string): unknown => {
    if (typeof v === "string") return r.string(v, where);
    if (Array.isArray(v)) return v.map((x) => walk(x, where));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x, `${where} · ${k}`);
      return out;
    }
    return v;
  };
  return walk(value, location) as T;
}
