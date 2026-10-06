/** Dev only: fill a store with many varied synthetic sessions to look at the list. tsx src/demo/seed-many.ts <db> */
import { PostrunStore } from "../store/store.js";
import type { Step } from "../schema/index.js";
const db = process.argv[2]!;
const store = new PostrunStore({ path: db });
let r = 7;
const rand = () => (r = (r * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const prompts = ["Add retry with backoff to the S3 uploader", "Why does the invoice date drift by a day in Lagos?", "Refactor the auth middleware into smaller pieces", "Write tests for the payments webhook", "how can i run the website in the apps/web folder", "Fix the flaky CI job on main", "Explain how sessions are stored", "Upgrade Next to 16 and fix the build", "", "Make the mobile nav fold on scroll"];
const projects = ["/Users/hero/Kraftyn/postrun", "/Users/hero/work/acme-api", "/Users/hero/Kraftyn/eventbrdge", "/Users/hero/clients/best-option-web"];
const now = Date.now();
for (let i = 0; i < Number(process.argv[3] ?? 26); i++) {
  const id = `seed-${String(i).padStart(3, "0")}-${Math.floor(rand() * 1e6)}`;
  const at = new Date(now - i * 5.3 * 3600_000 - rand() * 3600_000).toISOString();
  const kind = rand() < 0.75 ? "claude-code" : "cline";
  const prompt = prompts[i % prompts.length]!;
  const n = prompt ? Math.floor(rand() ** 2 * 260) + 3 : 0;
  const steps: Step[] = [];
  for (let k = 0; k < n; k++) {
    const x = rand();
    const type = k === 0 ? "message" : x < 0.38 ? "command" : x < 0.58 ? "edit" : x < 0.78 ? "read" : x < 0.9 ? "message" : "other";
    const failed = type === "command" && rand() < 0.12;
    steps.push({ id: `s${k}`, session_id: id, segment_index: 0, turn_id: "turn:1", actor_id: "root", seq: k + 1, at, type, decision: "auto", outcome: failed ? "failed" : "ok", content_status: "inline", channels: ["hook"], flags: [],
      payload: type === "message" ? { role: k === 0 ? "user" : "assistant", text: k === 0 ? prompt : "ok" } : type === "command" ? { command: "pnpm test" } : type === "other" ? { tool_name: "WebFetch" } : { path: "/w/a.ts", ...(type === "edit" ? { is_full_write: false } : {}) } } as Step);
  }
  const cost = n ? Number((rand() * 2.4).toFixed(4)) : 0;
  store.ingest({ id, agent: { kind, version: kind === "cline" ? "4.1.17" : "2.1.30" }, workspace: { root: projects[i % projects.length]! }, started_at: at,
    segments: [{ index: 0, start_reason: "startup", started_at: at, source_files: [] }], actors: [{ id: "root", type: "root" }],
    turns: [{ id: "turn:1", session_id: id, segment_index: 0, actor_id: "root", index: 1, started_at: at, step_ids: [] }], steps,
    metrics: { cost_usd: i % 7 === 3 ? 0 : cost, api_requests: i % 7 === 3 ? 0 : Math.ceil(n / 3), tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 } }, source: "seed" });
}
console.log(store.counts());
store.close();
