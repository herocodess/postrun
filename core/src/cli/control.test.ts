/** The review app's control actions that touch files: delete everything. Synthetic, in a temp home. */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PostrunStore } from "../store/store.js";
import { createControl, type Recorder } from "./control.js";
import { paths } from "./paths.js";

function recorder(): Recorder & { calls: string[] } {
  let paused = false;
  const calls: string[] = [];
  return {
    calls,
    since: new Date().toISOString(),
    health: {},
    paused: () => paused,
    pause: () => {
      paused = true;
      calls.push("pause");
    },
    resume: () => {
      paused = false;
      calls.push("resume");
    },
    restart: () => calls.push("restart"),
  };
}

describe("delete everything", () => {
  it("removes every raw capture file, including a rotated inbox and the spool, and resumes recording", async () => {
    const home = mkdtempSync(join(tmpdir(), "postrun-ctl-"));
    const p = paths({ HOME: home });
    const caps = p.captures;
    mkdirSync(join(caps, "sessions", "s1"), { recursive: true });
    mkdirSync(join(caps, "spool"), { recursive: true });
    const raw = {
      "sessions/s1/hooks.ndjson": "prompt",
      "spool/20261006T100000-1-1.ndjson": "prompt",
      "spool/.in.abc": "half",
      "hooks.ndjson": "prompt",
      "hooks.ndjson.routing": "prompt from before the rotation",
      ".router-state.json": "{}",
      "otlp-logs.ndjson": "old shared file",
    };
    for (const [f, body] of Object.entries(raw)) writeFileSync(join(caps, f), body);

    const store = new PostrunStore({ path: ":memory:" });
    const rec = recorder();
    const control = createControl({ paths: p, store, recorder: rec, log: () => undefined, port: 1234 });
    const r = await control.deleteAll();
    expect(r.deleted).toBe(0);
    const left = existsSync(caps) ? readdirSync(caps, { recursive: true }) : [];
    expect(left).toEqual([]);
    expect(rec.calls).toEqual(["pause", "resume"]);
    store.close();
  });
});

describe("stopping with a stale pid file", () => {
  it("never signals a process that is not Postrun, and removes the stale file", async () => {
    const { spawn } = await import("node:child_process");
    const { stop, status } = await import("./daemon.js");
    const home = mkdtempSync(join(tmpdir(), "postrun-pid-"));
    const p = paths({ HOME: home });
    mkdirSync(p.home, { recursive: true });
    // Some other program that happens to have the id the pid file names (after a reboot, say).
    const other = spawn("sleep", ["30"], { stdio: "ignore" });
    writeFileSync(p.pid, JSON.stringify({ pid: other.pid, port: 1, otlpPort: 1, version: "0.0.0", started_at: new Date().toISOString() }));
    expect((await status(p)).running).toBe(false);
    expect(await stop(p)).toBe(false);
    expect(other.exitCode).toBeNull();
    expect(other.killed).toBe(false);
    expect(existsSync(p.pid)).toBe(false);
    other.kill();
  });
});

describe("uninstall --delete-data", () => {
  it("only deletes a folder holding Postrun's own files, never the home folder", async () => {
    const { looksLikePostrunHome } = await import("./main.js");
    const home = mkdtempSync(join(tmpdir(), "postrun-home-"));
    const mine = join(home, ".postrun");
    mkdirSync(mine);
    expect(looksLikePostrunHome(mine, home)).toBe(false); // empty: not obviously Postrun's
    writeFileSync(join(mine, "config.json"), "{}");
    expect(looksLikePostrunHome(mine, home)).toBe(true);
    writeFileSync(join(home, "config.json"), "{}");
    expect(looksLikePostrunHome(home, home)).toBe(false); // POSTRUN_HOME=$HOME by mistake
    expect(looksLikePostrunHome(join(home, "Documents"), home)).toBe(false);
  });
});

describe("the git branch probe", () => {
  it("reads .git/HEAD without running git, follows worktrees, and ignores detached heads", async () => {
    const { gitBranch } = await import("./control.js");
    const root = mkdtempSync(join(tmpdir(), "postrun-git-"));
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/feat/redesign\n");
    // A repository's own config that would run code if git were run inside it.
    writeFileSync(join(root, ".git", "config"), `[core]\n\tfsmonitor = touch ${join(root, "pwned")}\n`);
    mkdirSync(join(root, "apps", "ui"), { recursive: true });
    expect(gitBranch(join(root, "apps", "ui"))).toBe("feat/redesign");
    expect(existsSync(join(root, "pwned"))).toBe(false);

    const wt = mkdtempSync(join(tmpdir(), "postrun-wt-"));
    mkdirSync(join(root, ".git", "worktrees", "w1"), { recursive: true });
    writeFileSync(join(root, ".git", "worktrees", "w1", "HEAD"), "ref: refs/heads/fix/audit\n");
    writeFileSync(join(wt, ".git"), `gitdir: ${join(root, ".git", "worktrees", "w1")}\n`);
    expect(gitBranch(wt)).toBe("fix/audit");

    writeFileSync(join(root, ".git", "HEAD"), "3c8bbc8a1f0e9d7c6b5a4f3e2d1c0b9a8f7e6d5c\n");
    expect(gitBranch(root)).toBeUndefined();
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/<img src=x>\n");
    expect(gitBranch(root)).toBeUndefined();
    expect(gitBranch(mkdtempSync(join(tmpdir(), "postrun-nogit-")))).toBeUndefined();
  });

  it("never reads a HEAD that is a device, a pipe or huge", async () => {
    const { gitBranch } = await import("./control.js");
    const { symlinkSync, rmSync } = await import("node:fs");
    const { execFileSync } = await import("node:child_process");
    const root = mkdtempSync(join(tmpdir(), "postrun-git-evil-"));
    mkdirSync(join(root, ".git"));
    symlinkSync("/dev/zero", join(root, ".git", "HEAD"));
    expect(gitBranch(root)).toBeUndefined();
    rmSync(join(root, ".git", "HEAD"));
    execFileSync("mkfifo", [join(root, ".git", "HEAD")]);
    expect(gitBranch(root)).toBeUndefined(); // would block forever if opened
    rmSync(join(root, ".git", "HEAD"));
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n" + "x".repeat(10_000));
    expect(gitBranch(root)).toBeUndefined();
  });
});
