/** Share links from this computer: signing in through the browser, uploading, and the review app's route. Against fake servers. */

import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createPostrunServer } from "../server/server.js";
import type { AppControl } from "../server/api.js";
import { PostrunStore } from "../store/store.js";
import type { Step } from "../schema/index.js";
import { accountFile, readAccount, ShareFailed, shareServer, startBrowserLogin, uploadReport, whoAmI, writeAccount } from "./client.js";

const TOKEN = "prt_" + "A".repeat(43);

async function fakeApp(handler: (req: IncomingMessage, body: Buffer) => { status: number; body?: unknown }) {
  const seen: Array<{ method: string; url: string; auth: string | undefined; body: Buffer }> = [];
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body });
      const r = handler(req, body);
      res.writeHead(r.status, { "content-type": "application/json" }).end(r.body === undefined ? "" : JSON.stringify(r.body));
    });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  return { url, seen, close: () => new Promise((ok) => srv.close(ok)) };
}

describe("the account file", () => {
  it("is private to this user and round-trips", () => {
    const home = mkdtempSync(join(tmpdir(), "postrun-acct-"));
    writeAccount(home, { server: "https://app.postrun.app", token: TOKEN, email: "a@b.c", saved_at: "now" });
    expect(statSync(accountFile(home)).mode & 0o777).toBe(0o600);
    expect(readAccount(home)?.token).toBe(TOKEN);
    writeFileSync(accountFile(home), "{ broken");
    expect(readAccount(home)).toBeUndefined();
  });

  it("uses app.postrun.app unless told otherwise", () => {
    expect(shareServer({})).toBe("https://app.postrun.app");
    expect(shareServer({ POSTRUN_SHARE_SERVER: "http://localhost:3001/" })).toBe("http://localhost:3001");
  });
});

describe("postrun login through the browser", () => {
  it("swaps a one-time code for a token, proving it started the login, and takes nothing from a stranger", async () => {
    const { createHash } = await import("node:crypto");
    let challenge = "";
    const app = await fakeApp((req, body) => {
      const { code, verifier } = JSON.parse(body.toString()) as { code: string; verifier: string };
      const ok = req.url === "/api/cli/token" && code === "C".repeat(32) && createHash("sha256").update(verifier).digest("base64url") === challenge;
      return ok ? { status: 200, body: { token: TOKEN } } : { status: 400, body: { error: "bad_code" } };
    });
    const login = await startBrowserLogin(app.url, { name: "laptop" });
    const u = new URL(login.url);
    challenge = u.searchParams.get("challenge") ?? "";
    expect(u.pathname).toBe("/cli");
    expect(u.searchParams.get("name")).toBe("laptop");
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The browser only ever carries a code; the URL holds the challenge, never the secret behind it.
    expect(login.url).not.toContain("verifier");
    const cb = `http://127.0.0.1:${u.searchParams.get("port")}/callback`;
    // A page that guesses the port but not the state gets nothing in.
    expect((await fetch(`${cb}?state=wrong&code=${"C".repeat(32)}`)).status).toBe(400);
    const ok = await fetch(`${cb}?state=${u.searchParams.get("state")}&code=${"C".repeat(32)}`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("Connected");
    await expect(login.token).resolves.toBe(TOKEN);
    expect(app.seen.map((r) => r.url)).toEqual(["/api/cli/token"]);
    await app.close();
  });

  it("fails cleanly when the code can't be swapped", async () => {
    const app = await fakeApp(() => ({ status: 400, body: { error: "bad_code", message: "expired" } }));
    const login = await startBrowserLogin(app.url);
    const u = new URL(login.url);
    const r = await fetch(`http://127.0.0.1:${u.searchParams.get("port")}/callback?state=${u.searchParams.get("state")}&code=${"C".repeat(32)}`);
    expect(r.status).toBe(400);
    await expect(login.token).rejects.toMatchObject({ code: "bad_code" });
    await app.close();
  });

  it("stops when the person cancels", async () => {
    const login = await startBrowserLogin("https://app.postrun.app");
    const u = new URL(login.url);
    await fetch(`http://127.0.0.1:${u.searchParams.get("port")}/callback?state=${u.searchParams.get("state")}&error=denied`);
    await expect(login.token).rejects.toMatchObject({ code: "denied" });
  });

  it("gives up after a while", async () => {
    const login = await startBrowserLogin("https://app.postrun.app", { timeoutMs: 50 });
    await expect(login.token).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("uploading", () => {
  it("sends only the gzipped report, with the token, and returns the link", async () => {
    const app = await fakeApp(() => ({ status: 201, body: { id: "x", url: "https://app.postrun.app/s/x", title: "t", expires_at: "2026-11-05T00:00:00Z" } }));
    const r = await uploadReport(app.url, TOKEN, "<!doctype html><title>t</title>", 30, "postrun/test");
    expect(r.url).toBe("https://app.postrun.app/s/x");
    const [req] = app.seen;
    expect(req?.url).toBe("/api/shares?expires=30");
    expect(req?.auth).toBe(`Bearer ${TOKEN}`);
    expect(gunzipSync(req!.body).toString()).toBe("<!doctype html><title>t</title>");
    await app.close();
  });

  it("says to sign in again when the token was removed", async () => {
    const app = await fakeApp(() => ({ status: 401, body: { error: "not_signed_in" } }));
    await expect(whoAmI(app.url, TOKEN, "postrun/test")).rejects.toMatchObject({ code: "not_signed_in" });
    await expect(uploadReport(app.url, TOKEN, "<!doctype html>", 7, "postrun/test")).rejects.toBeInstanceOf(ShareFailed);
    await app.close();
  });

  it("refuses an expiry the server doesn't offer, before sending anything", async () => {
    await expect(uploadReport("http://127.0.0.1:9", TOKEN, "<!doctype html>", 365, "postrun/test")).rejects.toMatchObject({ code: "bad_expiry" });
  });
});

describe("the review app's share route", () => {
  const at = new Date().toISOString();
  const session = {
    id: "cc-1",
    agent: { kind: "claude-code", version: "1" },
    workspace: { root: "/Users/someone/project" },
    started_at: at,
    segments: [{ index: 0, start_reason: "startup", started_at: at, source_files: [] }],
    actors: [{ id: "root", type: "root" }],
    turns: [{ id: "turn:1", session_id: "cc-1", segment_index: 0, actor_id: "root", index: 1, started_at: at, step_ids: [] }],
    steps: [{ id: "s1", session_id: "cc-1", segment_index: 0, turn_id: "turn:1", actor_id: "root", seq: 1, at, type: "message", decision: "n/a", outcome: "ok", content_status: "inline", channels: ["hook"], flags: [], payload: { role: "user", text: "use key sk-ant-api03-" + "x".repeat(90) } } as Step],
    metrics: { cost_usd: 0, api_requests: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 } },
    source: "test",
  };

  async function start(share: AppControl["share"]) {
    const store = new PostrunStore({ path: ":memory:" });
    store.ingest(session);
    const ui = mkdtempSync(join(tmpdir(), "postrun-ui-share-"));
    writeFileSync(join(ui, "index.html"), "x");
    const control = { share, account: async () => ({ signed_in: true, server: "https://app.postrun.app", email: "a@b.c" }) } as unknown as AppControl;
    const app = createPostrunServer({ port: 0, store, uiDir: ui, ingestToken: "t".repeat(32), control });
    const { url } = await app.start();
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(new URL("/api/sessions/cc-1/share", url), { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { url, post, stop: async () => (await app.stop(), store.close()) };
  }

  it("uploads the redacted export, never the raw session", async () => {
    let sent = "";
    const s = await start(async (html) => ((sent = html), { url: "https://app.postrun.app/s/abc", title: "t", expires_at: "x" }));
    const r = await s.post({ expires_days: 7 });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ url: "https://app.postrun.app/s/abc", masked: 1 });
    expect(sent).toContain("<!doctype html>");
    expect(sent).not.toContain("sk-ant-api03-xxxx");
    expect(sent).not.toContain("/Users/someone");
    await s.stop();
  });

  it("refuses other websites, odd expiries and unknown sessions", async () => {
    const s = await start(async () => ({ url: "u", title: "t", expires_at: "x" }));
    expect((await s.post({ expires_days: 7 }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await s.post({ expires_days: 365 })).status).toBe(400);
    expect((await fetch(new URL("/api/sessions/nope/share", s.url), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(404);
    await s.stop();
  });

  it("answers 409, not 401, when this computer isn't signed in, so the review app stays unlocked", async () => {
    const s = await start(async () => {
      throw new ShareFailed("not signed in", "not_signed_in");
    });
    const r = await s.post({ expires_days: 30 });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "not_signed_in" });
    expect(await (await fetch(new URL("/api/account", s.url))).json()).toMatchObject({ signed_in: true });
    await s.stop();
  });
});
