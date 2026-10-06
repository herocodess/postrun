/**
 * GET /api/me: who this computer is signed in as (postrun login checks it), and their plan.
 * DELETE /api/me: sign this computer out; its token stops working (postrun logout).
 */

import { apiError, fromError, json, unauthorized } from "@/lib/api";
import { clientIp, enforce, hit, LIMITS } from "@/lib/limit";
import { entitlementsFor, publicPlan } from "@/lib/entitlements";
import { revokeTokenById, userForToken } from "@/lib/shares";

async function who(req: Request) {
  const ip = clientIp(req.headers);
  await enforce(LIMITS.apiPerIp, ip);
  const w = await userForToken(req.headers.get("authorization"));
  if (!w) return (await hit(LIMITS.badTokenPerIp, ip)).ok ? unauthorized() : apiError(429, "slow_down", "Too many requests with a token that doesn't work.");
  return w;
}

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const w = await who(req);
    if (w instanceof Response) return w;
    // `plan` is additive: older CLIs read only email and name.
    return json({ email: w.email, name: w.name, plan: publicPlan(await entitlementsFor(w.user_id)) });
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const w = await who(req);
    if (w instanceof Response) return w;
    await revokeTokenById(w.token_id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return fromError(e);
  }
}
