/**
 * The pieces of the `postrun` command that touch other people's files or the
 * store: taking Postrun back out of Claude Code's settings exactly, leaving a
 * user's own telemetry alone, and the SQLite layer's transactions.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configureClaudeCode, foreignTelemetry, unconfigureClaudeCode } from "../capture/setup.js";
import { Database } from "../store/sqlite.js";
import { nodeOk } from "./doctor.js";
import { paths } from "./paths.js";
import { parseCommand, plist, unit } from "./service.js";

const tmp = () => mkdtempSync(join(tmpdir(), "postrun-cli-"));
/** The hook where setup puts it: <home>/.postrun/bin/capture-hook.sh */
function hookIn(dir: string): string {
  mkdirSync(join(dir, ".postrun", "bin"), { recursive: true });
  const h = join(dir, ".postrun", "bin", "capture-hook.sh");
  writeFileSync(h, "#!/bin/sh\n");
  return h;
}
const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

const USER_SETTINGS = {
  model: "opus",
  env: { MY_VAR: "1" },
  permissions: { allow: ["Bash(ls)"] },
  hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }], PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/usr/local/bin/guard" }] }] },
};

describe("Claude Code settings", () => {
  it("uninstall gives back exactly the settings the user had", () => {
    const dir = tmp();
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify(USER_SETTINGS, null, 2));
    const script = hookIn(dir);
    configureClaudeCode({ captureDir: join(dir, ".postrun", "captures"), settingsPath, script });
    const r = configureClaudeCode({ captureDir: join(dir, ".postrun", "captures"), settingsPath, script });
    expect(r.changed).toBe(false);
    expect(Object.keys(read(settingsPath)["hooks"] as object).length).toBeGreaterThan(2);
    const u = unconfigureClaudeCode({ settingsPath });
    expect(u.changed).toBe(true);
    expect(u.hooks_removed.sort()).toEqual(["PostToolUse", "PostToolUseFailure", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"]);
    expect(read(settingsPath)).toEqual(USER_SETTINGS);
    expect(unconfigureClaudeCode({ settingsPath }).changed).toBe(false);
  });

  it("uninstall keeps a telemetry setting the user had before Postrun", () => {
    const dir = tmp();
    const settingsPath = join(dir, "settings.json");
    const before = { env: { CLAUDE_CODE_ENABLE_TELEMETRY: "1" } };
    writeFileSync(settingsPath, JSON.stringify(before));
        configureClaudeCode({ captureDir: join(dir, ".postrun", "captures"), settingsPath, script: hookIn(dir) });
    unconfigureClaudeCode({ settingsPath });
    expect(read(settingsPath)).toEqual(before);
  });

  it("leaves telemetry the user sends elsewhere alone and records from hooks only", () => {
    const dir = tmp();
    const settingsPath = join(dir, "settings.json");
    const theirs = { env: { CLAUDE_CODE_ENABLE_TELEMETRY: "1", OTEL_LOGS_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com" } };
    writeFileSync(settingsPath, JSON.stringify(theirs));
        expect(foreignTelemetry(theirs.env)).toBe("OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.com");
    configureClaudeCode({ captureDir: "/c", settingsPath, script: hookIn(dir), telemetry: false });
    const env = read(settingsPath)["env"];
    expect(env).toEqual({ ...theirs.env, POSTRUN_CAPTURE_DIR: "/c" });
    unconfigureClaudeCode({ settingsPath });
    expect(read(settingsPath)).toEqual(theirs);
  });

  it("switching to hooks only takes back Postrun's own telemetry keys", () => {
    const dir = tmp();
    const settingsPath = join(dir, "settings.json");
        configureClaudeCode({ captureDir: "/c", settingsPath, script: hookIn(dir) });
    expect(foreignTelemetry(read(settingsPath)["env"] as Record<string, unknown>)).toBeUndefined();
    const r = configureClaudeCode({ captureDir: "/c", settingsPath, script: hookIn(dir), telemetry: false });
    expect(r.env_removed).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
    expect(read(settingsPath)["env"]).toEqual({ POSTRUN_CAPTURE_DIR: "/c" });
  });
});

describe("SQLite layer", () => {
  it("binds named parameters from objects, ignores extra keys, binds undefined as NULL", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a, b)");
    db.prepare("INSERT INTO t VALUES (@a, @b)").run({ a: 1, b: undefined, extra: "x" });
    expect(db.prepare("SELECT * FROM t").all()).toEqual([{ a: 1, b: null }]);
    expect(db.pragma("user_version", { simple: true })).toBe(0);
    db.close();
  });

  it("rolls a transaction back when it throws, and nests with savepoints", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a)");
    const add = db.transaction((v: number) => db.prepare("INSERT INTO t VALUES (?)").run(v));
    const outer = db.transaction(() => {
      add(1);
      try {
        db.transaction(() => {
          add(2);
          throw new Error("inner");
        })();
      } catch {
        // inner rolled back alone
      }
      add(3);
    });
    outer();
    expect(db.prepare("SELECT a FROM t ORDER BY a").all()).toEqual([{ a: 1 }, { a: 3 }]);
    expect(() =>
      db.transaction(() => {
        add(4);
        throw new Error("outer");
      })(),
    ).toThrow("outer");
    expect(db.prepare("SELECT count(*) AS n FROM t").get()).toEqual({ n: 2 });
    db.close();
  });
});

describe("Node version", () => {
  it("needs 22.13 or newer", () => {
    expect(nodeOk("22.12.0")).toBe(false);
    expect(nodeOk("20.18.0")).toBe(false);
    expect(nodeOk("22.13.0")).toBe(true);
    expect(nodeOk("24.1.0")).toBe(true);
  });
});

describe("start at login files", () => {
  const p = paths({ HOME: "/Users/a b" });
  const cmd = ["/opt/homebrew/bin/node", "/Users/a b/lib/node_modules/postrun/dist/postrun.js", "run"];
  it("launchd plist runs postrun run, restarts only after a crash, and round trips paths with spaces", () => {
    const text = plist(cmd, p);
    expect(parseCommand("launchd", text)).toEqual(cmd);
    expect(text).toContain("<key>SuccessfulExit</key><false/>");
    expect(text).toContain("<key>RunAtLoad</key><true/>");
  });
  it("systemd unit quotes its command", () => {
    const text = unit(cmd, p);
    expect(parseCommand("systemd", text)).toEqual(cmd);
    expect(text).toContain("Restart=on-failure");
    expect(text).toContain("WantedBy=default.target");
  });
  it("systemd unit keeps % and $ in paths literal, and refuses line breaks", () => {
    const odd = ["/opt/50%off/node", "/home/a/$HOME/postrun.js", "run"];
    const text = unit(odd, p);
    expect(text).toContain('"/opt/50%%off/node"');
    expect(text).toContain('"/home/a/$$HOME/postrun.js"');
    expect(parseCommand("systemd", text)).toEqual(odd);
    expect(() => unit(["/opt/a\nExecStartPre=/bin/evil", "run"], p)).toThrow(/line break/);
  });
});
