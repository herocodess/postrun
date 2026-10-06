/**
 * Redaction for anything that leaves this machine (exports now, share links
 * later). Pure: strings in, masked strings and findings out.
 *
 * Three passes per string, in order:
 *   1. Known secret formats (private keys, cloud and SaaS tokens, JWTs).
 *   2. Credential-shaped context: passwords in URLs, Authorization headers,
 *      and NAME=value / "name": "value" / name: value where the name is a
 *      credential word (API_KEY, token, password, client_secret, ...).
 *   3. A fallback for long, random-looking strings that no rule names.
 *   4. Personal details: email addresses, and home directories
 *      (/Users/<name>, /home/<name>, /root, C:\Users\<name>) -> ~.
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
  | "gitlab-token"
  | "npm-token"
  | "huggingface-token"
  | "sendgrid-key"
  | "google-oauth-secret"
  | "webhook-url"
  | "url-password"
  | "auth-header"
  | "cookie"
  | "credential"
  | "high-entropy"
  | "email";

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
  // To the END line, or to the end of the text when the output was cut off before it (head id_rsa).
  ["private-key", /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$(?![\s\S]))/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ["openai-key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
  ["stripe-key", /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,})\b/g],
  ["slack-token", /\b(?:xox[abposre]|xapp)-[A-Za-z0-9-]{10,}/g],
  ["webhook-url", /https:\/\/(?:hooks\.slack\.com\/(?:services|workflows|triggers)|(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks)\/[A-Za-z0-9/_-]+/g],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["google-oauth-secret", /\bGOCSPX-[A-Za-z0-9_-]{20,}/g],
  ["gitlab-token", /\bglpat-[A-Za-z0-9_-]{20,}/g],
  ["npm-token", /\bnpm_[A-Za-z0-9]{36}\b/g],
  ["huggingface-token", /\bhf_[A-Za-z0-9]{30,}\b/g],
  ["sendgrid-key", /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
];

/** scheme://user:password@host, and scheme://:password@host (Redis). */
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]*:)([^\s@/]+)(@)/gi;
/** Authorization schemes in any case: "authorization: bearer …" is common in logs and curl -v output. */
const AUTH_HEADER = /\b(Bearer|Basic|Token)(\s+)([A-Za-z0-9._~+/=-]{16,})/gi;
/** The whole value of a Cookie or Set-Cookie header. */
const COOKIE_HEADER = /\b((?:Set-)?Cookie)(:[ \t]*)([^\r\n]{6,})/gi;
/** curl -u user:password and --user user:password. */
const USER_FLAG = /((?:^|\s)(?:-u|--user)(?:\s+|=))(["']?)([^\s:"']+:)([^\s"']{4,})\2/g;
/** Long flags that take a secret: --password value, --token=value, --api-key value. */
const SECRET_FLAG = /(--(?:password|passwd|pass|token|secret|api-key|apikey|auth-token|access-token|client-secret)(?:=|\s+))(["']?)((?!\[REDACTED)[^\s"']{4,})\2/gi;

/**
 * NAME <sep> VALUE where NAME may be quoted. The value must be 6+ characters
 * and not already a mask. Whether NAME is a credential is decided in code
 * (isCredentialName), which is easier to keep precise than one regex.
 */
const ASSIGNMENT = /(["']?)\b([A-Za-z_][A-Za-z0-9_.-]{1,80})\1(\s*(?::|=|:=)\s*)(["']?)((?!\[REDACTED)[^\s"'`]{6,})\4/g;
/** The same with a quoted value that may contain spaces: DB_PASSWORD="correct horse battery". */
const QUOTED_ASSIGNMENT = /(["']?)\b([A-Za-z_][A-Za-z0-9_.-]{1,80})\1(\s*(?::|=|:=)\s*)(["'])((?!\[REDACTED)[^"'\r\n]*\s[^"'\r\n]*)\4/g;

/** Credential words as whole segments of a snake/kebab/dotted name: API_KEY, db.password, x-auth-token. */
const SEGMENT_WORDS = /(?:^|[_.-])(?:secret|secrets|token|password|passwd|pwd|passphrase|apikey|api[_.-]?key|private[_.-]?key|access[_.-]?key|secret[_.-]?key|credential|credentials|auth|client[_.-]?secret|session[_.-]?key|signing[_.-]?key|webhook[_.-]?secret)(?:$|[_.-])/i;
/** The same words at the end of a camelCase name: apiKey, accessToken, clientSecret, dbPassword. */
const CAMEL_WORDS = /(?:[a-z0-9](?:ApiKey|Token|Secret|Password|Passwd|PrivateKey|AccessKey|Credentials?))$|^(?:apiKey|token|secret|password|passwd|credentials?)$/;

/** Values that are clearly not secrets even under a credential name. */
const NOT_A_SECRET = /^(?:true|false|null|nil|none|undefined|required|optional|string|number|boolean|\*+|x{3,}|changeme|redacted|example|placeholder|your[_-].*|<.*>|\$\{.*\}|\$[A-Z_]+|process\.env\..*|os\.environ.*|env\(.*)$/i;

/** Credential words run together at the end of a name: PGPASSWORD, MYSQL_PWD is covered above, DBTOKEN. */
const SUFFIX_WORDS = /(?:password|passwd|passphrase|secret|apikey)$/i;

export function isCredentialName(name: string): boolean {
  return SEGMENT_WORDS.test(name) || CAMEL_WORDS.test(name) || SUFFIX_WORDS.test(name);
}

/**
 * Long strings that look random: 32+ characters with upper case, lower case and digits, and no
 * rule above named them (bare AWS secret keys, custom API tokens). Hex (git hashes, digests) has
 * no upper case and is left alone, as are integrity hashes (sha512-…) and base64 data URIs.
 */
const RANDOM_LOOKING = /(?<![A-Za-z0-9+/=_-])(?<!sha(?:1|256|384|512)-)(?<!base64,)(?!sha(?:1|256|384|512)-)(?=[A-Za-z0-9+/_=-]*[A-Z])(?=[A-Za-z0-9+/_=-]*[a-z])(?=[A-Za-z0-9+/_=-]*[0-9])[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9+/=_-])/g;

function looksRandom(s: string): boolean {
  if (/^[A-Za-z]+[A-Za-z0-9]*$/.test(s) && /[a-z][A-Z]/.test(s) && !/[0-9].*[0-9].*[0-9]/.test(s)) return false; // CamelCaseIdentifiers
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h >= 4;
}

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
/** Addresses that identify nobody: the masks above, documentation domains, git's noreply. */
const EMAIL_KEEP = /@(?:example\.(?:com|org|net)|users\.noreply\.github\.com|noreply\.[a-z.]+)$|^(?:git|noreply|no-reply)@/i;

const HOME_PATHS: RegExp[] = [
  /\/(?:Users|home)\/[A-Za-z0-9._-]+(?=\/|\b|$)/g,
  // /root as the start of a path, not as a word inside one (https://x/root/…).
  /(?<![\w.~/-])\/root(?=\/|\s|$|["'`])/g,
  // C:\Users\name, also as written inside JSON (C:\\Users\\name).
  /\b[A-Za-z]:(?:\\\\|\\)Users(?:\\\\|\\)[^\\\s"']+/g,
];

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
    out = out.replace(COOKIE_HEADER, (_m, name: string, sep: string) => {
      hits.push("cookie");
      return name + sep + mask("cookie");
    });
    out = out.replace(USER_FLAG, (_m, flag: string, q: string, user: string) => {
      hits.push("credential");
      return `${flag}${q}${user}${mask("credential")}${q}`;
    });
    out = out.replace(SECRET_FLAG, (m, flag: string, q: string, val: string) => {
      if (NOT_A_SECRET.test(val)) return m;
      hits.push("credential");
      return `${flag}${q}${mask("credential")}${q}`;
    });
    const assignment = (m: string, q1: string, name: string, sep: string, q2: string, val: string) => {
      if (!isCredentialName(name) || NOT_A_SECRET.test(val.trim())) return m;
      hits.push("credential");
      return `${q1}${name}${q1}${sep}${q2}${mask("credential")}${q2}`;
    };
    out = out.replace(QUOTED_ASSIGNMENT, assignment);
    out = out.replace(ASSIGNMENT, assignment);
    out = out.replace(RANDOM_LOOKING, (m: string) => {
      if (!looksRandom(m)) return m;
      hits.push("high-entropy");
      return mask("high-entropy");
    });
    out = out.replace(EMAIL, (m: string) => {
      if (EMAIL_KEEP.test(m)) return m;
      hits.push("email");
      return mask("email");
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
 * Deep-redact every string in a JSON-like value: values, and keys too, since a
 * tool's raw input can use data as keys ({"sk-…": true}). The walk path becomes
 * the reader-facing location label.
 */
export function redactDeep<T>(value: T, r: Redactor, location: string): T {
  const walk = (v: unknown, where: string): unknown => {
    if (typeof v === "string") return r.string(v, where);
    if (Array.isArray(v)) return v.map((x) => walk(x, where));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        const key = r.string(k, `${where} · key`);
        out[key] = walk(x, `${where} · ${key}`);
      }
      return out;
    }
    return v;
  };
  return walk(value, location) as T;
}
