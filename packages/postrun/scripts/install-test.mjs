/**
 * Install test: what an interviewee does, in a throwaway home folder.
 *
 *   npm pack, npm install -g (into a temporary prefix), postrun setup,
 *   fake Claude Code hooks and telemetry, a fake Cline session, then check the
 *   review app, the API, export, delete, doctor, status, restart and uninstall.
 *
 * No repo files are used at run time: the installed package must stand alone.
 * Run: pnpm --filter postrun test:install
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "postrun-install-"));
const prefix = join(work, "prefix");
const home = join(work, "home");
const PORT = 4571;
let failures = 0;

const ok = (cond, what) => {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${what}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Pack and install, as from npm.
console.log(`work folder ${work}`);
const packed = execFileSync("npm", ["pack", "--pack-destination", work, "--silent"], { cwd: pkgDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim().split("\n").pop();
const tarball = join(work, packed);
ok(existsSync(tarball), `packed ${packed} (${Math.round(statSync(tarball).size / 1024)} KB)`);
const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
ok(!/\.ts$|\.map$|\.test\./m.test(listing.replace(/\.d\.ts$/gm, "")), "no TypeScript sources, maps or tests in the package");
execFileSync("npm", ["install", "-g", "--prefix", prefix, tarball, "--silent", "--no-audit", "--no-fund"], { stdio: "inherit" });
const bin = join(prefix, "bin", "postrun");
ok(existsSync(bin), "postrun is on the PATH after npm install -g");
const deps = readdirSync(join(prefix, "lib", "node_modules", "postrun")).filter((f) => f === "node_modules");
ok(deps.length === 0, "installs with no dependencies");

// 2. A home folder with Claude Code settings and a Cline session.
mkdirSync(join(home, ".claude"), { recursive: true });
const userSettings = { model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } };
writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify(userSettings, null, 2));
const clineId = "1760000000000";
const clineDir = join(home, ".cline", "data", "sessions", clineId);
mkdirSync(clineDir, { recursive: true });
const t0 = Date.parse("2026-10-06T09:00:00Z");
writeFileSync(
  join(clineDir, `${clineId}.messages.json`),
  JSON.stringify({
    version: 1,
    sessionId: clineId,
    origin: { version: "4.1.17" },
    messages: [
      { id: "m1", role: "user", ts: t0, content: [{ type: "text", text: "fix the date bug" }] },
      { id: "m2", role: "assistant", ts: t0 + 1000, content: [{ type: "text", text: "Looking at it." }, { type: "tool_use", id: "tu1", name: "run_commands", input: { commands: ["pnpm test"] } }], metrics: { cost: 0.01, inputTokens: 100, outputTokens: 10 } },
      { id: "m3", role: "user", ts: t0 + 2000, content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ query: "pnpm test", result: "1 failed", success: false }] }] },
      { id: "m4", role: "assistant", ts: t0 + 3000, content: [{ type: "text", text: "Fixed." }] },
    ],
  }),
);
writeFileSync(join(clineDir, `${clineId}.json`), JSON.stringify({ session_id: clineId, cwd: "/w/cline", started_at: new Date(t0).toISOString(), status: "completed" }));

const env = { ...process.env, HOME: home, PATH: `${join(prefix, "bin")}:${process.env.PATH}` };
for (const k of Object.keys(env)) if (k.startsWith("POSTRUN_")) delete env[k];
const postrun = (args, opts = {}) => {
  const r = spawnSync(bin, args, { env, encoding: "utf8", timeout: 60_000, ...opts });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
// The review app's key, as `postrun open` hands it to the browser.
const appKey = () => readFileSync(join(home, ".postrun", "ingest-token"), "utf8").trim();
const api = async (path, { key = true } = {}) => {
  const headers = { connection: "close", ...(key ? { authorization: `Bearer ${appKey()}` } : {}) };
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { headers });
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text() };
};

try {
  // 3. Setup.
  const setup = postrun(["setup", "--port", String(PORT), "--no-autostart", "--no-open"]);
  console.log(setup.out.replace(/^/gm, "      | "));
  ok(setup.code === 0, "postrun setup succeeds");
  ok(/Postrun is recording/.test(setup.out), "setup says it is recording");
  ok(!/ExperimentalWarning|SQLite is an experimental/.test(setup.out), "no Node experimental warnings shown");
  const hook = join(home, ".postrun", "bin", "capture-hook.sh");
  ok(existsSync(hook) && (statSync(hook).mode & 0o777) === 0o700, "hook script installed in ~/.postrun/bin, owner only");
  const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  ok(settings.hooks.SessionStart?.[0]?.hooks?.[0]?.command === hook, "Claude Code hooks point at ~/.postrun/bin");
  ok(settings.hooks.Stop.some((g) => g.hooks[0].command === "say done"), "the user's own hook is kept");
  ok((statSync(join(home, ".postrun")).mode & 0o777) === 0o700, "~/.postrun is owner only");

  // 4. Claude Code: hooks through the installed script, telemetry to the receiver.
  const sid = "cc-install-0001";
  const fire = (ev, extra = {}) =>
    execFileSync(hook, [], { input: JSON.stringify({ session_id: sid, hook_event_name: ev, cwd: "/w/app", ...extra }), env: { ...env, POSTRUN_CAPTURE_DIR: settings.env.POSTRUN_CAPTURE_DIR } });
  fire("SessionStart", { source: "startup" });
  fire("UserPromptSubmit", { prompt_id: "p1", prompt: "add a health check" });
  fire("PostToolUse", { prompt_id: "p1", tool_use_id: "t1", tool_name: "Bash", tool_input: { command: "curl localhost/health" }, tool_response: { stdout: "AWS_SECRET_ACCESS_KEY=abcdEFGHijklMNOPqrstUVWXyz0123456789ABCD\nok", stderr: "" } });
  fire("PostToolUse", { prompt_id: "p1", tool_use_id: "t2", tool_name: "Edit", tool_input: { file_path: "/w/app/a.ts", old_string: "a", new_string: "b" }, tool_response: { filePath: "/w/app/a.ts", structuredPatch: [] } });
  const otlp = settings.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const attr = (key, v) => ({ key, value: typeof v === "number" ? { intValue: v } : { stringValue: String(v) } });
  // Claude Code sends the headers setup put in its settings; a request without them is not stored.
  const [hName, hValue] = String(settings.env.OTEL_EXPORTER_OTLP_HEADERS ?? "").split("=");
  ok(hName === "x-postrun-key" && (hValue ?? "").length >= 32, "setup gives Claude Code a telemetry key");
  const tele = await fetch(`${otlp}/v1/logs`, {
    method: "POST",
    headers: { "content-type": "application/json", [hName]: hValue },
    body: JSON.stringify({
      resourceLogs: [
        {
          resource: { attributes: [attr("service.version", "2.1.30")] },
          scopeLogs: [{ logRecords: [{ attributes: [attr("event.name", "api_request"), attr("session.id", sid), attr("prompt.id", "p1"), attr("event.timestamp", new Date().toISOString()), attr("event.sequence", 1), attr("cost_usd", "0.02"), attr("input_tokens", 1000), attr("output_tokens", 50)] }] }],
        },
      ],
    }),
  });
  ok(tele.status === 200, "telemetry receiver accepts Claude Code logs");
  const web = await fetch(`${otlp}/v1/logs`, { method: "POST", headers: { "content-type": "text/plain; application/json", origin: "https://evil.example" }, body: "{}" });
  ok(web.status === 403, "telemetry receiver refuses a request from a web page");
  ok((await api("/api/sessions", { key: false })).status === 401, "the API refuses requests without the key");
  fire("Stop", { prompt_id: "p1", last_assistant_message: "Added /health." });

  let list;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    list = JSON.parse((await api("/api/sessions")).body);
    if (list.sessions.length >= 2 && list.sessions.find((s) => s.id === sid)?.metrics.cost_usd > 0) break;
  }
  const cc = list.sessions.find((s) => s.id === sid);
  const cl = list.sessions.find((s) => s.agent.kind === "cline");
  ok(cc !== undefined, "Claude Code session recorded");
  ok(cc?.steps_total === 4 && cc?.metrics.cost_usd === 0.02, `Claude Code steps and cost (${cc?.steps_total} steps, $${cc?.metrics.cost_usd})`);
  ok(cl !== undefined && cl.steps_total >= 3, `Cline session recorded (${cl?.steps_total} steps)`);

  // 5. The review app and API.
  const index = await api("/");
  ok(index.status === 200 && index.type.startsWith("text/html") && index.body.includes("<html"), "review app served");
  const asset = /src="(\/_next\/static\/[^"]+\.js)"/.exec(index.body)?.[1];
  ok(asset !== undefined && (await api(asset)).status === 200, "review app scripts served");
  const page = await api(`/session?id=${sid}`);
  ok(page.status === 200, "session page served");
  const detail = JSON.parse((await api(`/api/sessions/${sid}`)).body);
  ok(detail.steps.length === 4, "session detail API");
  const health = JSON.parse((await api("/api/health")).body);
  ok(health.ok === true && health.version === JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version, `health reports version ${health.version}`);

  // 6. Everyday commands.
  const status = postrun(["status"]);
  ok(status.code === 0 && status.out.includes(`127.0.0.1:${PORT}`), "postrun status");
  const sessions = postrun(["sessions"]);
  ok(sessions.code === 0 && sessions.out.includes(sid) && sessions.out.includes("add a health check"), "postrun sessions");
  const exp = postrun(["export", sid, "-o", join(work, "report.html")]);
  const html = existsSync(join(work, "report.html")) ? readFileSync(join(work, "report.html"), "utf8") : "";
  ok(exp.code === 0 && html.includes("add a health check") && !html.includes("abcdEFGHijklMNOP"), "postrun export writes a redacted report");
  const doc = postrun(["doctor"]);
  console.log(doc.out.replace(/^/gm, "      | "));
  ok(doc.code === 0, "postrun doctor finds no problems");
  const restart = postrun(["restart"]);
  ok(restart.code === 0 && (await api("/api/health")).status === 200, "postrun restart");
  const again = postrun(["setup", "--no-autostart", "--no-open"]);
  ok(again.code === 0 && /already running|restarted|started/.test(again.out), "setup can be run again");
  const del = postrun(["delete", sid, "--yes"]);
  ok(del.code === 0 && (await api(`/api/sessions/${sid}`)).status === 404, "postrun delete");

  // 7. Uninstall gives the user their settings back.
  const un = postrun(["uninstall", "--yes", "--delete-data"]);
  console.log(un.out.replace(/^/gm, "      | "));
  ok(un.code === 0, "postrun uninstall succeeds");
  ok(JSON.stringify(JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"))) === JSON.stringify(userSettings), "Claude Code settings are exactly what the user had");
  ok(!existsSync(join(home, ".postrun")), "~/.postrun deleted");
  let down = false;
  try {
    await api("/api/health");
  } catch {
    down = true;
  }
  ok(down, "nothing listening any more");
} finally {
  postrun(["stop"]);
  if (failures === 0) rmSync(work, { recursive: true, force: true });
}

console.log(failures === 0 ? "\ninstall test passed" : `\ninstall test: ${failures} failure(s); files kept in ${work}`);
process.exit(failures === 0 ? 0 : 1);
