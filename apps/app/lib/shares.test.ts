/** The parts of share links that need no database: reading uploads, ids, tokens, redirects, dates, the email. */

import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { describeDevice, describeLocation, signInHtml, signInText } from "./email";
import { relative } from "./format";
import { hashToken, isShareId, looksLikeCliToken, newCliToken, randomId } from "./ids";
import { safeNext } from "./paths";
import { MAX_UPLOAD_BYTES, parseExpiryDays, readReport, reportAgent, reportTitle, ShareError, shareStatus, tokenName } from "./shares";

const REPORT = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="generator" content="postrun">
<meta name="postrun:agent" content="claude-code">
<title>Fix the &quot;flaky&quot; CI job &amp; tests · postrun report</title></head><body>hi</body></html>`;

describe("reading an upload", () => {
  it("accepts a gzipped Postrun report and keeps it gzipped", () => {
    const gz = gzipSync(REPORT);
    const r = readReport(gz, null);
    expect(r.html).toBe(REPORT);
    expect(r.size).toBe(Buffer.byteLength(REPORT));
    expect(r.gz.equals(gz)).toBe(true);
  });

  it("accepts plain HTML and compresses it for storage", () => {
    const r = readReport(Buffer.from(REPORT), null);
    expect(r.gz[0]).toBe(0x1f);
    expect(r.html).toBe(REPORT);
  });

  it("refuses empty, oversized, broken and non-HTML uploads", () => {
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as ShareError).code;
      }
      return "accepted";
    };
    expect(code(() => readReport(Buffer.alloc(0), null))).toBe("empty");
    expect(code(() => readReport(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 32), null))).toBe("too_large");
    expect(code(() => readReport(Buffer.from([0x1f, 0x8b, 1, 2, 3]), null))).toBe("bad_gzip");
    expect(code(() => readReport(gzipSync('{"not":"html"}'), null))).toBe("not_html");
    // Any other HTML, such as a fake sign-in page, is refused: only Postrun's own reports are hosted.
    expect(code(() => readReport(gzipSync('<!doctype html><title>Sign in</title><form action="https://evil.example"><input name="password"></form>'), null))).toBe("not_html");
    expect(code(() => readReport(gzipSync(REPORT.replace("hi", '<form action="https://evil.example"><input name="password"></form>')), null))).toBe("not_html");
    expect(code(() => readReport(gzipSync(REPORT.replace("hi", "<script>steal()</script>")), null))).toBe("not_html");
    // A small upload that unpacks to something huge (a zip bomb) is refused, not unpacked.
    expect(code(() => readReport(gzipSync(Buffer.alloc(80 * 1024 * 1024, 32)), null))).toBe("bad_gzip");
  });

  it("takes the title and agent from the report, unescaped and without the suffix", () => {
    expect(reportTitle(REPORT)).toBe('Fix the "flaky" CI job & tests');
    expect(reportAgent(REPORT)).toBe("claude-code");
    expect(reportTitle("<!doctype html><title></title>")).toBe("Untitled session");
    expect(reportAgent("<!doctype html>")).toBeNull();
    expect(reportTitle(`<!doctype html><title>${"x".repeat(300)}</title>`)).toHaveLength(200);
  });
});

describe("expiry and status", () => {
  it("allows only the offered lengths", () => {
    expect(parseExpiryDays(null)).toBe(30);
    expect(parseExpiryDays("7")).toBe(7);
    for (const bad of ["0", "365", "abc", "-1", "7.5"]) expect(() => parseExpiryDays(bad)).toThrow(ShareError);
  });

  it("is off when turned off, expired when past its date, live otherwise", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    expect(shareStatus({ expires_at: new Date("2026-10-07T00:00:00Z"), revoked_at: null }, now)).toBe("live");
    expect(shareStatus({ expires_at: new Date("2026-10-06T11:59:59Z"), revoked_at: null }, now)).toBe("expired");
    expect(shareStatus({ expires_at: new Date("2026-10-07T00:00:00Z"), revoked_at: now }, now)).toBe("off");
  });
});

describe("ids and tokens", () => {
  it("makes share ids that are long, random and URL-safe", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => randomId()));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(isShareId(id)).toBe(true);
    expect(isShareId("../../etc/passwd")).toBe(false);
  });

  it("makes CLI tokens that are only stored as a hash", () => {
    const t = newCliToken();
    expect(looksLikeCliToken(t.token)).toBe(true);
    expect(t.hash).toBe(hashToken(t.token));
    expect(t.hash).not.toContain(t.token.slice(4));
    expect(t.token.startsWith(t.prefix)).toBe(true);
    expect(t.prefix.length).toBeLessThan(12);
    expect(looksLikeCliToken("prt_short")).toBe(false);
  });

  it("names computers in plain text", () => {
    expect(tokenName("Hero's MacBook Pro")).toBe("Hero's MacBook Pro");
    expect(tokenName('<img src=x onerror="a">')).toBe("img srcx onerrora");
    expect(tokenName("")).toBe("A computer");
    expect(tokenName("x".repeat(100))).toHaveLength(60);
  });
});

describe("where sign-in sends you back to", () => {
  it("only ever a path on this site", () => {
    expect(safeNext("/cli?port=4000&state=abc")).toBe("/cli?port=4000&state=abc");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "evil", "/x\r\nSet-Cookie: a=b", "/\tevil", "", null, undefined]) expect(safeNext(bad)).toBe("/shares");
  });
});

describe("the sign-in email", () => {
  it("escapes the link and says how long it lasts", () => {
    const url = 'https://app.postrun.app/api/auth/magic-link/verify?token=abc&callbackURL=%2F"><script>';
    const html = signInHtml(url, "a<b>@example.com", { at: new Date("2026-10-06T17:25:00Z"), device: "Chrome on macOS", location: "Lagos, Nigeria" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("a<b>@");
    expect(html).toContain("token=abc&amp;callbackURL");
    expect(html).toContain("cid:postrun-logo");
    expect(html).toContain("Lagos, Nigeria");
    expect(signInText(url, "a@b.c")).toContain("10 minutes");
  });

  it("describes the device and place a request came from, roughly", () => {
    expect(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36")).toBe("Chrome on macOS");
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iOS");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0")).toBe("Edge on Windows");
    expect(describeDevice(undefined)).toBeUndefined();
    expect(describeLocation(new Headers({ "x-vercel-ip-city": "San%20Francisco", "x-vercel-ip-country": "US" }))).toBe("San Francisco, United States");
    expect(describeLocation(new Headers())).toBeUndefined();
  });
});

describe("dates", () => {
  it("reads like speech", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    expect(relative(new Date("2026-10-13T12:00:00Z"), now)).toBe("in 7 days");
    expect(relative(new Date("2026-10-06T11:30:00Z"), now)).toBe("30 min ago");
    expect(relative(new Date("2026-10-05T12:00:00Z"), now)).toBe("1 day ago");
    expect(relative(now, now)).toBe("just now");
  });
});
