import { describe, expect, it } from "vitest";
import { createRedactor, isCredentialName, redactDeep } from "./redact.js";

const red = (s: string) => {
  const r = createRedactor();
  const out = r.string(s, "test");
  return { out, report: r.report() };
};

// Built from parts so this file never contains a string that a secret scanner would flag as real.
const fake = {
  anthropic: "sk-ant-" + "api03-" + "a".repeat(40),
  openai: "sk-" + "proj-" + "b".repeat(40),
  github: "ghp_" + "c".repeat(36),
  aws: "AKIA" + "ABCDEFGHIJKLMNOP",
  stripe: "sk_" + "live_" + "d".repeat(24),
  slack: "xoxb-" + "1234567890-abcdefghij",
  google: "AIza" + "e".repeat(35),
  jwt: "eyJ" + "hbGciOiJIUzI1NiJ9" + ".eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0" + ".dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  pem: "-----BEGIN " + "RSA PRIVATE KEY-----\nMIIEow\nIBAAKC\n-----END " + "RSA PRIVATE KEY-----",
};

describe("known secret formats", () => {
  it.each([
    ["anthropic-key", fake.anthropic],
    ["openai-key", fake.openai],
    ["github-token", fake.github],
    ["aws-access-key", fake.aws],
    ["stripe-key", fake.stripe],
    ["slack-token", fake.slack],
    ["google-api-key", fake.google],
    ["jwt", fake.jwt],
    ["private-key", fake.pem],
  ])("masks %s", (kind, secret) => {
    const { out, report } = red(`before ${secret} after`);
    expect(out).toBe(`before [REDACTED:${kind}] after`);
    expect(report.counts).toEqual({ [kind]: 1 });
    expect(report.findings[0]).toMatchObject({ kind, location: "test" });
    expect(report.findings[0]?.context).not.toContain(secret);
  });
});

describe("credential-shaped context", () => {
  it("masks env, JSON, YAML and flag assignments with credential names", () => {
    const input = [
      "DATABASE_PASSWORD=hunter2hunter2",
      'export STRIPE_WEBHOOK_SECRET="whsec_abcdef123"',
      '{"apiKey": "k-123456789", "client_secret": "cs_987654321"}',
      "auth_token: tok_abcdefgh",
      "--password=correcthorse",
      "x-auth-token: abcdef123456",
    ].join("\n");
    const { out, report } = red(input);
    expect(out).toBe(
      [
        "DATABASE_PASSWORD=[REDACTED:credential]",
        'export STRIPE_WEBHOOK_SECRET="[REDACTED:credential]"',
        '{"apiKey": "[REDACTED:credential]", "client_secret": "[REDACTED:credential]"}',
        "auth_token: [REDACTED:credential]",
        "--password=[REDACTED:credential]",
        "x-auth-token: [REDACTED:credential]",
      ].join("\n"),
    );
    expect(report.counts.credential).toBe(7);
  });

  it("masks URL passwords and Authorization headers, keeping the user and scheme", () => {
    const { out } = red("postgres://app:s3cretpass@db.internal:5432/prod\ncurl -H 'Authorization: Bearer abcdefghijklmnopqrstu'");
    expect(out).toBe("postgres://app:[REDACTED:url-password]@db.internal:5432/prod\ncurl -H 'Authorization: Bearer [REDACTED:auth-header]'");
  });

  it("leaves look-alikes alone", () => {
    const keep = [
      'author = "Alexander Hamilton"',
      "tokenizer = whitespace_tokenizer",
      "const tokenCount = 123456789",
      "password: ${DB_PASSWORD}",
      "API_KEY=process.env.API_KEY",
      "secret: changeme",
      "TOKEN=<your-token-here>",
      "passwordless_login: enabled_for_all",
      "maxTokens: 4096000",
    ].join("\n");
    const { out, report } = red(keep);
    expect(out).toBe(keep);
    expect(report.findings).toEqual([]);
  });

  it("decides credential names by whole segment or camelCase suffix", () => {
    for (const n of ["API_KEY", "db.password", "x-auth-token", "accessToken", "clientSecret", "AWS_SECRET_ACCESS_KEY", "token", "auth"]) {
      expect(isCredentialName(n), n).toBe(true);
    }
    for (const n of ["author", "tokenizer", "tokenCount", "maxTokens", "passwordless", "secretary", "authority"]) {
      expect(isCredentialName(n), n).toBe(false);
    }
  });
});

describe("home paths", () => {
  it("replaces macOS, Linux and Windows home directories with ~ and counts them", () => {
    const { out, report } = red("/Users/hero/Kraftyn/postrun and /home/ci/app and C:\\Users\\Hero\\code");
    expect(out).toBe("~/Kraftyn/postrun and ~/app and ~\\code");
    expect(report.home_paths).toBe(3);
    expect(report.findings).toEqual([]);
  });
});

describe("behaviour", () => {
  it("is idempotent", () => {
    const once = red(`KEY ${fake.github} PASSWORD=abcdefgh /Users/hero/x`).out;
    const twice = red(once);
    expect(twice.out).toBe(once);
    expect(twice.report.findings).toEqual([]);
  });

  it("gives each finding context around its own mask", () => {
    const { report } = red(`first ${fake.aws} middle ${"x".repeat(200)} second ${fake.github} end`);
    expect(report.findings.map((f) => f.kind)).toEqual(["aws-access-key", "github-token"]);
    expect(report.findings[0]?.context).toContain("first [REDACTED:aws-access-key] middle");
    expect(report.findings[1]?.context).toContain("second [REDACTED:github-token] end");
  });

  it("redactDeep masks every string value, keeps keys and other types, and labels locations", () => {
    const r = createRedactor();
    const out = redactDeep({ command: `echo ${fake.openai}`, exit_code: 0, raw: { headers: [`Bearer ${"z".repeat(20)}`] } }, r, "step 3 · command");
    expect(out).toEqual({ command: "echo [REDACTED:openai-key]", exit_code: 0, raw: { headers: ["Bearer [REDACTED:auth-header]"] } });
    expect(r.report().findings.map((f) => f.location)).toEqual(["step 3 · command · command", "step 3 · command · raw · headers"]);
  });
});
