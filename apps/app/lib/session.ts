/** The signed-in person, for server components, server actions and route handlers. */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { safeNext } from "./paths";

export { safeNext };

export interface Viewer {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

export async function viewer(): Promise<Viewer | undefined> {
  const s = await auth().api.getSession({ headers: await headers() });
  if (!s) return undefined;
  // An email-link account has no name of its own (Better Auth may store the address); show it once, not twice.
  const name = s.user.name && s.user.name !== s.user.email ? s.user.name : "";
  return { id: s.user.id, email: s.user.email, name, image: s.user.image ?? null };
}

/** The signed-in person, or a redirect to sign in that comes back to `next` afterwards. */
export async function requireViewer(next: string): Promise<Viewer> {
  const v = await viewer();
  if (!v) redirect(`/login?next=${encodeURIComponent(safeNext(next))}`);
  return v;
}
