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
