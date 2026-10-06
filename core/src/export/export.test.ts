import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Step } from "../schema/index.js";
import { createPostrunServer, type PostrunServer } from "../server/server.js";
import type { ExportReviewResponse } from "../server/api.js";
import { generateToken } from "../server/token.js";
import { PostrunStore, type SessionRecord } from "../store/index.js";
import { exportSession } from "./index.js";

const SID = "exp-1";
const T0 = "2026-10-05T22:00:00.000Z";
const GH = "ghp_" + "Q".repeat(36);
const PW = "hunter2hunter2";
const HOST = "heros-macbook-pro.local";

const base = { session_id: SID, segment_index: 0, turn_id: "t0", actor_id: "root", decision: "accepted", outcome: "ok", content_status: "inline" as const, channels: ["hook"], flags: [] };
const steps: Step[] = [
  { ...base, id: "m0", seq: 0, at: T0, decision: "n/a", type: "message", payload: { role: "user", text: "deploy with token " + GH + " please" } },
  { ...base, id: "c1", seq: 1, at: "2026-10-05T22:00:05.000Z", type: "command", payload: { command: "env | grep DB", stdout: `DB_PASSWORD=${PW}\nDB_HOST=localhost`, exit_code: 0, cwd: "/Users/hero/Kraftyn/postrun" } },
  { ...base, id: "e2", seq: 2, at: "2026-10-05T22:00:09.000Z", type: "edit", payload: { path: "/Users/hero/Kraftyn/postrun/src/a.ts", old_string: "const a = 1;", new_string: "const a = 2;", is_full_write: false } },
  { ...base, id: "m3", seq: 3, at: "2026-10-05T22:00:12.000Z", decision: "n/a", type: "message", payload: { role: "assistant", text: '<script>alert("x")</script><img src=x onerror=alert(1)> done' } },
  { ...base, id: "c4", seq: 4, at: "2026-10-05T22:01:30.000Z", type: "command", outcome: "failed", error: { type: "ShellError", message: "exit 1" }, payload: { command: "npm test", stderr: "1 failing", exit_code: 1 } },
];
const record: SessionRecord = {
  id: SID,
  agent: { kind: "claude-code", version: "2.1.0" },
  workspace: { root: "/Users/hero/Kraftyn/postrun" },
  started_at: T0,
  ended_at: "2026-10-05T22:02:00.000Z",
  segments: [{ index: 0, start_reason: "start", started_at: T0, source_files: ["/Users/hero/.postrun/captures/hooks.ndjson"] }],
  actors: [{ id: "root", type: "root" }],
  turns: [{ id: "t0", session_id: SID, segment_index: 0, actor_id: "root", index: 0, started_at: T0, step_ids: [] }],
  steps,
  metrics: { cost_usd: 0.42, api_requests: 6, tokens: { input: 1200, output: 300, cache_read: 0, cache_creation: 0 } },
  source: "/Users/hero/.postrun/captures",
  verdict: { state: "needs_attention", note: "private note: ask Hero about the db password" },
};

describe("exportSession", () => {
  const store = new PostrunStore({ path: ":memory:", capturedOn: HOST });
  store.ingest(record);
  const result = exportSession(store.getSession(SID)!, { now: new Date("2026-10-06T08:00:00Z") });
  const { html, redaction } = result;

  it("contains no secrets, home paths, machine name, capture paths, or verdict note", () => {
    for (const leak of [GH, PW, "/Users/hero", HOST, ".postrun/captures", "private note"]) expect(html, leak).not.toContain(leak);
    expect(html).toContain("[REDACTED:github-token]");
    expect(html).toContain("DB_PASSWORD=[REDACTED:credential]");
    expect(html).toContain("~/Kraftyn/postrun");
  });

  it("reports what it masked, by step", () => {
    expect(redaction.counts).toEqual({ "github-token": 1, credential: 1 });
    expect(redaction.findings.map((f) => f.location)).toEqual(["step 0 · message · text", "step 1 · command · stdout"]);
    expect(redaction.home_paths).toBeGreaterThanOrEqual(3);
    expect(html).toContain("Redacted on export: 1 GitHub token, 1 credential.");
  });

  it("neutralises HTML in captured content and ships no script at all", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain(`http-equiv="Content-Security-Policy" content="default-src 'none'`);
  });

  it("takes the title from the redacted prompt", () => {
    expect(html).toContain("<h1>deploy with token [REDACTED:github-token] please</h1>");
  });

  it("renders the report: stats, files, commands, diff, failures, flags", () => {
    expect(html).toContain("~/Kraftyn/postrun/src/a.ts");
    expect(html).toContain('<span class="del">- const a = 1;</span>');
    expect(html).toContain('<span class="add">+ const a = 2;</span>');
    expect(html).toContain("failed · ShellError");
    expect(html).toContain("$0.42");
    expect(html).toContain("2m 0s");
    expect(html).toMatch(/secret in output<\/b> 1 value redacted on export/);
    expect((html.match(/<details class="step/g) ?? []).length).toBe(5);
  });

  it("names the file and never touches the stored session", () => {
    expect(result.filename).toBe("postrun-claude-code-2026-10-05-exp-1.html");
    expect(JSON.stringify(store.getSession(SID))).toContain(GH);
  });
});

describe("export over the API", () => {
  let app: PostrunServer;
  let url: string;
  const store = new PostrunStore({ path: ":memory:" });
  const uiDir = mkdtempSync(join(tmpdir(), "postrun-ui-"));
  writeFileSync(join(uiDir, "index.html"), "<!doctype html>");

  beforeAll(async () => {
    store.ingest(record);
    app = createPostrunServer({ port: 0, store, uiDir, ingestToken: generateToken() });
    url = (await app.start()).url;
  });
  afterAll(async () => {
    await app.stop();
    store.close();
  });

  it("downloads the report as a sandboxed attachment", async () => {
    const r = await fetch(new URL(`/api/sessions/${SID}/export`, url));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="postrun-claude-code-2026-10-05-exp-1.html"');
    expect(r.headers.get("content-security-policy")).toBe("sandbox");
    const body = await r.text();
    expect(body).toContain("<!doctype html>");
    expect(body).not.toContain(GH);
  });

  it("previews what would be masked", async () => {
    const r = (await (await fetch(new URL(`/api/sessions/${SID}/export/review`, url))).json()) as ExportReviewResponse;
    expect(r.filename).toMatch(/\.html$/);
    expect(r.bytes).toBeGreaterThan(1000);
    expect(r.redaction.findings).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain(GH);
  });

  it("404s an unknown session", async () => {
    expect((await fetch(new URL("/api/sessions/nope/export", url))).status).toBe(404);
  });
});

describe("exportSession masks a secret wherever it is stored", () => {
  it("leaves no copy in any field of any step type, including keys and adapter-filled fields", () => {
    const S = "ghp_" + "Z".repeat(36);
    const all: Step[] = [
      { ...base, id: "a", seq: 0, at: T0, type: "message", payload: { role: "user", text: `use ${S}` } },
      { ...base, id: "b", seq: 1, at: T0, type: "command", channels: ["hook", S], decision: S, payload: { command: `echo ${S}`, stdout: S, stderr: S, cwd: `/tmp/${S}`, output_ref: S } },
      { ...base, id: "c", seq: 2, at: T0, type: "edit", outcome: "failed", error: { type: S, message: S }, payload: { path: `/w/${S}.ts`, old_string: S, new_string: S, structured_patch: [{ lines: [`+${S}`] }], is_full_write: false } },
      { ...base, id: "d", seq: 3, at: T0, type: "read", flags: [{ kind: S, severity: "warn", reason: S }], payload: { path: `/w/${S}` } },
      { ...base, id: "e", seq: 4, at: T0, type: "other", payload: { tool_name: S, raw: { [S]: [S, { nested: S }] } } },
    ];
    const rec: SessionRecord = { ...record, id: "exp-all", agent: { kind: "claude-code", version: S }, workspace: { root: `/w/${S}`, repo: S }, steps: all.map((s) => ({ ...s, session_id: "exp-all" })) as Step[], turns: [{ ...record.turns[0]!, session_id: "exp-all", mode: S }] };
    const st = new PostrunStore({ path: ":memory:" });
    st.ingest(rec);
    const { html } = exportSession(st.getSession("exp-all")!, { now: new Date("2026-10-06T08:00:00Z") });
    expect(html).not.toContain(S);
    expect(html).not.toContain("Z".repeat(36));
    st.close();
  });
});
