/**
 * POST /api/cli/token { code, verifier } -> { token }
 *
 * The last step of `postrun login`: the computer swaps the one-time code the
 * browser handed it for a token, proving it is the computer that started the
 * login (PKCE). The token never appears in a URL or the browser.
 */

import { apiError, fromError, json, readBody } from "@/lib/api";
import { clientIp, enforce, LIMITS } from "@/lib/limit";
import { exchangeCliCode } from "@/lib/shares";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await enforce(LIMITS.codePerIp, clientIp(req.headers));
    const raw = await readBody(req, 4096);
    if (!raw) return apiError(413, "too_large", "Request too large.");
    let body: { code?: unknown; verifier?: unknown };
    try {
      body = JSON.parse(raw.toString("utf8")) as typeof body;
    } catch {
      return apiError(400, "bad_json", "Send JSON: { code, verifier }.");
    }
    if (typeof body.code !== "string" || typeof body.verifier !== "string") return apiError(400, "bad_code", "Send JSON: { code, verifier }.");
    return json({ token: await exchangeCliCode(body.code, body.verifier) });
  } catch (e) {
    return fromError(e);
  }
}
