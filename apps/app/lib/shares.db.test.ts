/**
 * Share links against a real Postgres. Runs only when TEST_DATABASE_URL points at a
 * throwaway database (it creates and drops its own schema); skipped otherwise.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postrun_test pnpm test
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env["TEST_DATABASE_URL"];
const SCHEMA = `t_${process.pid}`;

describe.skipIf(!URL_)("share links in Postgres", () => {
  let mod: typeof import("./shares");
  let db: typeof import("./db");
  const report = (title: string) => ({ gz: gzipSync(`<!doctype html><title>${title}</title>`), html: `<!doctype html><title>${title}</title>`, size: 40 });
  // (createShare trusts readReport's checks; these tests are about storage and limits.)

  beforeAll(async () => {
    // Every connection in the pool works inside the test schema.
    const u = new URL(URL_!);
    u.searchParams.set("options", `-c search_path=${SCHEMA}`);
    process.env["DATABASE_URL"] = u.toString();
    db = await import("./db");
    mod = await import("./shares");
    await db.query(`CREATE SCHEMA ${SCHEMA}`);
    await db.query(`CREATE TABLE "user" (id text PRIMARY KEY, email text NOT NULL, name text NOT NULL DEFAULT '')`);
    await db.query(readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8"));
    await db.query(`INSERT INTO "user" (id, email) VALUES ('ana', 'ana@example.com'), ('ben', 'ben@example.com')`);
  });

  afterAll(async () => {
    if (!db) return;
    await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await db.pool().end();
  });

  it("creates, opens and counts a link", async () => {
    const s = await mod.createShare("ana", report("First"), 7);
    expect(s.title).toBe("First");
    expect(mod.shareStatus(s)).toBe("live");
    expect((await mod.openReport(s.id))?.length).toBeGreaterThan(0);
    await mod.openReport(s.id);
    const [row] = await mod.listShares("ana");
    expect(row?.opens).toBe(2);
    expect(await mod.listShares("ben")).toEqual([]);
  });

  it("only the owner can turn a link off, and then the report is gone", async () => {
    const s = await mod.createShare("ana", report("Second"), 7);
    expect(await mod.revokeShare("ben", s.id)).toBe(false);
    expect(await mod.openReport(s.id)).toBeDefined();
    expect(await mod.revokeShare("ana", s.id)).toBe(true);
    expect(await mod.openReport(s.id)).toBeUndefined();
    const [left] = await db.query<{ html_gz: Buffer | null }>(`SELECT html_gz FROM share WHERE id = $1`, [s.id]);
    expect(left?.html_gz).toBeNull();
    expect(await mod.deleteShare("ben", s.id)).toBe(false);
    expect(await mod.deleteShare("ana", s.id)).toBe(true);
  });

  it("expired links stop opening and lose their report on the next upload", async () => {
    const s = await mod.createShare("ana", report("Old"), 1);
    await db.query(`UPDATE share SET expires_at = now() - interval '1 minute' WHERE id = $1`, [s.id]);
    expect(await mod.openReport(s.id)).toBeUndefined();
    await mod.createShare("ben", report("New"), 1);
    const [left] = await db.query<{ html_gz: Buffer | null }>(`SELECT html_gz FROM share WHERE id = $1`, [s.id]);
    expect(left?.html_gz).toBeNull();
  });

  it("limits uploads per hour", async () => {
    await db.query(`INSERT INTO share (id, user_id, title, size_bytes, expires_at) SELECT 'x' || g, 'ben', 't', 1, now() + interval '1 day' FROM generate_series(1, 30) g`);
    await expect(mod.createShare("ben", report("Too many"), 1)).rejects.toMatchObject({ code: "slow_down" });
  });

  it("finds the person behind a CLI token, and forgets a removed one", async () => {
    const { token, row } = await mod.createToken("ana", "Laptop");
    expect(await mod.userForToken(`Bearer ${token}`)).toMatchObject({ user_id: "ana", email: "ana@example.com" });
    expect(await mod.userForToken(token)).toBeUndefined();
    expect(await mod.userForToken(`Bearer ${token.slice(0, -1)}x`)).toBeUndefined();
    expect(await mod.revokeToken("ben", row.id)).toBe(false);
    expect(await mod.revokeToken("ana", row.id)).toBe(true);
    expect(await mod.userForToken(`Bearer ${token}`)).toBeUndefined();
    const [stored] = await db.query<{ token_hash: string }>(`SELECT token_hash FROM cli_token WHERE id = $1`, [row.id]);
    expect(stored?.token_hash).not.toContain(token.slice(4, 20));
  });

  it("swaps a login code for a token once, only with the right secret, and only briefly", async () => {
    const { randomBytes } = await import("node:crypto");
    const verifier = randomBytes(32).toString("base64url");
    const code = await mod.createCliCode("ana", "Laptop", mod.challengeFor(verifier));
    // The wrong secret burns the code.
    await expect(mod.exchangeCliCode(code, randomBytes(32).toString("base64url"))).rejects.toMatchObject({ code: "bad_code" });
    await expect(mod.exchangeCliCode(code, verifier)).rejects.toMatchObject({ code: "bad_code" });

    const v2 = randomBytes(32).toString("base64url");
    const c2 = await mod.createCliCode("ana", "Laptop", mod.challengeFor(v2));
    const token = await mod.exchangeCliCode(c2, v2);
    expect(await mod.userForToken(`Bearer ${token}`)).toMatchObject({ user_id: "ana" });
    await expect(mod.exchangeCliCode(c2, v2)).rejects.toMatchObject({ code: "bad_code" });

    const v3 = randomBytes(32).toString("base64url");
    const c3 = await mod.createCliCode("ana", "Laptop", mod.challengeFor(v3));
    await db.query(`UPDATE cli_code SET expires_at = now() - interval '1 second'`);
    await expect(mod.exchangeCliCode(c3, v3)).rejects.toMatchObject({ code: "bad_code" });
  });

  it("keeps to the limits when uploads arrive at the same moment", async () => {
    await db.query(`INSERT INTO "user" (id, email) VALUES ('cat', 'cat@example.com')`);
    await db.query(`INSERT INTO share (id, user_id, title, size_bytes, expires_at) SELECT 'c' || g, 'cat', 't', 1, now() + interval '1 day' FROM generate_series(1, 25) g`);
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => mod.createShare("cat", report(`p${i}`), 1)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const [n] = await db.query<{ c: string }>(`SELECT count(*) AS c FROM share WHERE user_id = 'cat'`);
    expect(Number(n?.c)).toBe(30);
  });

  it("rate limits per subject, in fixed windows, without storing the subject", async () => {
    const { hit } = await import("./limit");
    const limit = { name: "test", max: 2, seconds: 60 };
    expect((await hit(limit, "victim@example.com")).ok).toBe(true);
    expect((await hit(limit, "Victim@Example.com ")).ok).toBe(true);
    const third = await hit(limit, "victim@example.com");
    expect(third.ok).toBe(false);
    expect(third.retryAfter).toBeGreaterThan(0);
    expect((await hit(limit, "someone@else.com")).ok).toBe(true);
    const rows = await db.query<{ key: string }>(`SELECT key FROM rate_limit`);
    expect(JSON.stringify(rows)).not.toContain("example.com");
    await db.query(`UPDATE rate_limit SET window_start = now() - interval '2 minutes'`);
    expect((await hit(limit, "victim@example.com")).ok).toBe(true);
  });

  it("deleting an account deletes its links and tokens", async () => {
    await db.query(`DELETE FROM "user" WHERE id = 'ana'`);
    expect(await mod.listShares("ana")).toEqual([]);
    expect(await mod.listTokens("ana")).toEqual([]);
  });
});
