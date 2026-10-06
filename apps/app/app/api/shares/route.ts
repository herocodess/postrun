/**
 * POST /api/shares: upload a redacted report and get its link.
 *
 *   Authorization: Bearer prt_…        (from postrun login)
 *   Content-Encoding: gzip              (the report, gzipped; plain HTML also works)
 *   ?expires=1|7|30|90                  (days; default 30)
 *
 * 201 { id, url, title, expires_at }
 */

import { apiError, fromError, json, readBody, unauthorized } from "@/lib/api";
import { baseUrl } from "@/lib/env";
import { createShare, MAX_UPLOAD_BYTES, parseExpiryDays, readReport, userForToken } from "@/lib/shares";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const who = await userForToken(req.headers.get("authorization"));
    if (!who) return unauthorized();
    const days = parseExpiryDays(new URL(req.url).searchParams.get("expires"));
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    if (!body) return apiError(413, "too_large", "This report is too large to share (over 4 MB compressed).");
    const report = readReport(body, req.headers.get("content-encoding") ?? req.headers.get("x-content-encoding"));
    const share = await createShare(who.user_id, report, days);
    return json({ id: share.id, url: `${baseUrl()}/s/${share.id}`, title: share.title, expires_at: share.expires_at.toISOString() }, 201);
  } catch (e) {
    return fromError(e);
  }
}
