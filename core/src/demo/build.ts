/**
 * pnpm --filter @postrun/core demo:data <out-dir>
 *
 * Writes the static API the demo review app reads, using the real store and
 * exporter so the demo matches what Postrun produces:
 *   <out>/sessions.json                    GET /api/sessions
 *   <out>/sessions/<id>.json               GET /api/sessions/:id
 *   <out>/exports/<id>.review.json         GET /api/sessions/:id/export/review
 *   <out>/exports/<id>.html                GET /api/sessions/:id/export
 *   <out>/dashboard-<days>.json            GET /api/dashboard?days=1|7|30
 *   <out>/projects.json                    GET /api/projects
 *   <out>/project-files/<root>.json        GET /api/projects/files?root=
 *   <out>/usage.json                       GET /api/usage (an example month of use)
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { exportSession } from "../export/index.js";
import { sessionReport } from "../report/index.js";
import type { ExportReviewResponse, ProjectFilesResponse, ProjectsResponse, SessionDetailResponse, SessionListResponse, UsageResponse } from "../server/api.js";
import { formatUsage } from "../store/usage.js";
import { PostrunStore } from "../store/index.js";
import { demoSessions } from "./sessions.js";

const out = resolve(process.argv[2] ?? "demo-data");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "sessions"), { recursive: true });
mkdirSync(join(out, "exports"), { recursive: true });
mkdirSync(join(out, "project-files"), { recursive: true });

const store = new PostrunStore({ path: ":memory:", ownerId: "you", capturedOn: "your machine" });
for (const r of demoSessions()) store.ingest(r);

const page = store.querySessions();
const sessions = page.sessions;
const list: SessionListResponse = { ...page, agents: store.agentKinds() };
writeFileSync(join(out, "sessions.json"), JSON.stringify(list));

for (const s of sessions) {
  const full = store.getSession(s.id)!;
  // Full steps, not previews: the static demo has no per-step endpoint to fetch the rest from.
  const detail: SessionDetailResponse = { ...full, report: sessionReport(full.steps), as_of: full.summary.updated_at };
  writeFileSync(join(out, "sessions", `${s.id}.json`), JSON.stringify(detail));
  const ex = exportSession(full, { now: new Date("2026-10-06T08:00:00.000Z") });
  const review: ExportReviewResponse = { filename: ex.filename, bytes: Buffer.byteLength(ex.html), redaction: ex.redaction };
  writeFileSync(join(out, "exports", `${s.id}.review.json`), JSON.stringify(review));
  writeFileSync(join(out, "exports", `${s.id}.html`), ex.html);
  process.stdout.write(`  ${s.agent.kind.padEnd(11)} ${s.id}  ${s.steps_total} steps, ${ex.redaction.findings.length} masked\n`);
}
// The dashboard is "as of" the newest demo session, so the demo never looks empty as the dates age.
const newest = Math.max(...sessions.map((s) => Date.parse(s.updated_at || s.started_at)));
for (const days of [1, 7, 30]) writeFileSync(join(out, `dashboard-${days}.json`), JSON.stringify(store.dashboard(days, new Date(newest + 60_000))));
const projects = store.projects();
writeFileSync(join(out, "projects.json"), JSON.stringify({ projects } satisfies ProjectsResponse));
for (const p of projects) {
  // Same file name rule as the review app's api.projectFiles in demo mode.
  const name = p.root.replace(/[^A-Za-z0-9._-]+/g, "_");
  writeFileSync(join(out, "project-files", `${name}.json`), JSON.stringify({ root: p.root, files: store.projectFiles(p.root) } satisfies ProjectFilesResponse));
}
// An example month for Settings > Your usage, as of the newest demo session. Fixed, so builds match.
{
  const asOf = new Date(newest + 60_000);
  const plan: Array<[number, Array<[string, number]>]> = [
    [0, [["app_opened", 2], ["session_viewed", 4], ["review_marked", 2], ["pr_summary_copied", 1], ["changes_viewed", 2], ["keyboard_used", 1]]],
    [1, [["app_opened", 1], ["session_viewed", 3], ["review_marked", 1], ["search", 2]]],
    [2, [["app_opened", 1], ["session_viewed", 2], ["report_exported", 1]]],
    [4, [["app_opened", 3], ["session_viewed", 6], ["review_marked", 3], ["pr_summary_copied", 2], ["changes_viewed", 3], ["search", 1]]],
    [5, [["app_opened", 1], ["session_viewed", 1]]],
    [8, [["app_opened", 2], ["session_viewed", 5], ["review_marked", 2], ["keyboard_used", 1], ["search", 3]]],
    [9, [["app_opened", 1], ["session_viewed", 2], ["pr_summary_copied", 1]]],
    [12, [["app_opened", 1], ["session_viewed", 3], ["reports_zipped", 1]]],
    [15, [["app_opened", 2], ["session_viewed", 4], ["review_marked", 2], ["changes_viewed", 1]]],
    [19, [["app_opened", 1], ["session_viewed", 2], ["backup_saved", 1]]],
    [23, [["app_opened", 1], ["session_viewed", 1]]],
  ];
  for (const [daysAgo, events] of plan) {
    const at = new Date(asOf.getTime() - daysAgo * 86_400_000);
    for (const [e, n] of events) for (let i = 0; i < n; i++) store.countUsage(e, at);
  }
  const usage = store.usage({ version: "0.2.0", platform: "darwin arm64" }, asOf);
  writeFileSync(join(out, "usage.json"), JSON.stringify({ ...usage, text: formatUsage(usage) } satisfies UsageResponse));
}
store.close();
process.stdout.write(`demo data written to ${out}\n`);
