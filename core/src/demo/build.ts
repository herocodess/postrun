/**
 * pnpm --filter @postrun/core demo:data <out-dir>
 *
 * Writes the static API the demo review app reads, using the real store and
 * exporter so the demo matches what Postrun produces:
 *   <out>/sessions.json                    GET /api/sessions
 *   <out>/sessions/<id>.json               GET /api/sessions/:id
 *   <out>/exports/<id>.review.json         GET /api/sessions/:id/export/review
 *   <out>/exports/<id>.html                GET /api/sessions/:id/export
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { exportSession } from "../export/index.js";
import { sessionReport } from "../report/index.js";
import type { ExportReviewResponse, SessionDetailResponse, SessionListResponse } from "../server/api.js";
import { PostrunStore } from "../store/index.js";
import { demoSessions } from "./sessions.js";

const out = resolve(process.argv[2] ?? "demo-data");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "sessions"), { recursive: true });
mkdirSync(join(out, "exports"), { recursive: true });

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
store.close();
process.stdout.write(`demo data written to ${out}\n`);
