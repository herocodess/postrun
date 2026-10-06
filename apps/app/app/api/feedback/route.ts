/**
 * POST /api/feedback { rating?, message?, email?, source, version?, platform?, usage? }
 *
 * From the review app (through the local background process), `postrun
 * feedback`, or this site. No account needed; when the request carries a CLI
 * token (Authorization: Bearer prt_…) it is linked to that account. The admins
 * get an email for each one.
 */

import { after } from "next/server";
import { apiError, fromError, json, readBody } from "@/lib/api";
import { sendFeedbackAlert } from "@/lib/email";
import { adminEmails, baseUrl } from "@/lib/env";
import { readFeedback, saveFeedback } from "@/lib/feedback";
import { clientIp, enforce, LIMITS } from "@/lib/limit";
import { userForToken } from "@/lib/shares";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await enforce(LIMITS.feedbackPerIp, clientIp(req.headers), "That's a lot of feedback in an hour. Thank you! Try again later.");
    const raw = await readBody(req, 16 * 1024);
    if (!raw) return apiError(413, "too_large", "That's too long to send.");
    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      return apiError(400, "bad_json", "Send JSON.");
    }
    const input = readFeedback(body);
    const who = req.headers.get("authorization") ? await userForToken(req.headers.get("authorization")) : undefined;
    const row = await saveFeedback(input, who?.user_id);
    after(() => sendFeedbackAlert(adminEmails(), row, `${baseUrl()}/admin#${row.id}`).catch((e: unknown) => console.error(e)));
    return json({ id: row.id, thanks: true }, 201);
  } catch (e) {
    return fromError(e);
  }
}
