import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { locateClineSession } from "../adapters/cline/index.js";
import { PostrunStore, claudeCodeRecord, clineRecord } from "../store/index.js";
import type { SessionDetailResponse, SessionListResponse } from "./api.js";
import { createPostrunServer, LOCALHOST, PortInUseError, type PostrunServer } from "./server.js";

const CAPTURES = process.env["POSTRUN_CAPTURES"] ?? join(homedir(), ".postrun", "captures");
const CC_SESSION = process.env["POSTRUN_CC_SESSION"] ?? "3ac04cde-89b6-4e88-941b-72293de124c3";
const hasCaptures = existsSync(join(CAPTURES, "otlp-logs.ndjson")) && existsSync(join(CAPTURES, "hooks.ndjson"));
const CLINE = process.env["POSTRUN_CLINE_SESSION"] ?? "1788568010939_qp82o";
let hasCline = false;
try {
  hasCline = existsSync(locateClineSession(CLINE).messages_path);
} catch {
  hasCline = false;
}

describe.skipIf(!hasCaptures || !hasCline)("postrun server over the store", () => {
  let app: PostrunServer;
  let url: string;
  let port: number;
  const uiDir = mkdtempSync(join(tmpdir(), "postrun-ui-"));
  writeFileSync(join(uiDir, "index.html"), "<!doctype html><title>t</title><div id=app></div>");
  writeFileSync(join(uiDir, "session.html"), "<!doctype html><title>s</title>");
  const store = new PostrunStore({ path: ":memory:" });

  beforeAll(async () => {
    store.ingest(claudeCodeRecord(CAPTURES, CC_SESSION));
    store.ingest(clineRecord(CLINE));
    app = createPostrunServer({ port: 0, store, uiDir });
    const bound = await app.start();
    url = bound.url;
    port = bound.port;
  });
  afterAll(async () => {
    await app.stop();
    store.close();
  });

  it("binds to 127.0.0.1 only", () => {
    const addr = app.server.address();
    expect(addr && typeof addr !== "string" ? addr.address : addr).toBe(LOCALHOST);
    expect(url.startsWith(`http://${LOCALHOST}:`)).toBe(true);
  });

  it("GET /api/sessions lists both sessions newest-first and filters by agent", async () => {
    const res = await fetch(new URL("/api/sessions", url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionListResponse;
    expect(body.sessions.map((s) => s.agent.kind)).toEqual(["cline", "claude-code"]);
    expect(body.agents).toEqual(["claude-code", "cline"]);
    expect(body.sessions[0]!.title).toBeDefined();
    expect(body.sessions[0]!.metrics.cost_usd).toBeGreaterThan(0);
    const filtered = (await (await fetch(new URL("/api/sessions?agent=claude-code", url))).json()) as SessionListResponse;
    expect(filtered.sessions).toHaveLength(1);
    expect(filtered.sessions[0]!.agent.kind).toBe("claude-code");
  });

  it("GET /api/sessions/:id returns the full session with report projections", async () => {
    const list = (await (await fetch(new URL("/api/sessions", url))).json()) as SessionListResponse;
    const cc = list.sessions.find((s) => s.agent.kind === "claude-code")!;
    const res = await fetch(new URL(`/api/sessions/${cc.id}`, url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionDetailResponse;
    expect(body.steps).toHaveLength(100);
    expect(body.turns.length).toBeGreaterThan(0);
    expect(body.report.files.length).toBeGreaterThan(0);
    expect(body.report.commands.length).toBeGreaterThan(0);
    expect(body.report.counts.files_edited).toBeGreaterThan(0);
    const gitPush = body.steps.find((s) => s.seq === 604)!;
    expect(gitPush.content_status).toBe("reference_only");
    expect(gitPush.outcome).toBe("failed");
    expect(body.report.commands.some((c) => c.command === "(command not inline)" && c.reference_only === 1)).toBe(true);

    const cl = list.sessions.find((s) => s.agent.kind === "cline")!;
    const clBody = (await (await fetch(new URL(`/api/sessions/${cl.id}`, url))).json()) as SessionDetailResponse;
    expect(clBody.turns.some((t) => t.mode === "plan")).toBe(true);
    expect(clBody.report.counts.files_created).toBeGreaterThan(0);

    const missing = await fetch(new URL("/api/sessions/nope", url));
    expect(missing.status).toBe(404);
  });

  it("serves the static export, including extensionless routes, and refuses traversal", async () => {
    expect((await fetch(url)).status).toBe(200);
    const session = await fetch(new URL("/session", url));
    expect(session.status).toBe(200);
    expect(session.headers.get("content-type")).toContain("text/html");
    expect((await fetch(new URL("/..%2f..%2fpackage.json", url))).status).toBe(403);
    expect((await fetch(new URL("/nope.js", url))).status).toBe(404);
    expect((await fetch(new URL("/api/sessions", url), { method: "POST" })).status).toBe(405);
  });

  it("fails with a clear message when the port is in use", async () => {
    const second = createPostrunServer({ port, store, uiDir });
    await expect(second.start()).rejects.toBeInstanceOf(PortInUseError);
    await expect(second.start()).rejects.toThrow(`Port ${port} is already in use on 127.0.0.1`);
  });
});
