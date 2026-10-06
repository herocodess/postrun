/**
 * GET /api/me: who this computer is signed in as (postrun login checks it).
 * DELETE /api/me: sign this computer out; its token stops working (postrun logout).
 */

import { fromError, json, unauthorized } from "@/lib/api";
import { revokeTokenById, userForToken } from "@/lib/shares";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const who = await userForToken(req.headers.get("authorization"));
    if (!who) return unauthorized();
    return json({ email: who.email, name: who.name });
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const who = await userForToken(req.headers.get("authorization"));
    if (!who) return unauthorized();
    await revokeTokenById(who.token_id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return fromError(e);
  }
}
