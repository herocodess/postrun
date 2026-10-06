"use server";

/** What the account pages can change. Each action checks who is signed in and only touches their own rows. */

import { revalidatePath } from "next/cache";
import { enforce, LIMITS } from "@/lib/limit";
import { createToken, deleteShare, revokeShare, revokeToken, ShareError } from "@/lib/shares";
import { isShareId } from "@/lib/ids";
import { requireViewer } from "@/lib/session";

export async function turnOffShare(id: string): Promise<void> {
  const v = await requireViewer("/shares");
  if (isShareId(id)) await revokeShare(v.id, id);
  revalidatePath("/shares");
}

export async function removeShare(id: string): Promise<void> {
  const v = await requireViewer("/shares");
  if (isShareId(id)) await deleteShare(v.id, id);
  revalidatePath("/shares");
}

export async function signOutComputer(id: string): Promise<void> {
  const v = await requireViewer("/settings");
  if (typeof id === "string" && id.length <= 32) await revokeToken(v.id, id);
  revalidatePath("/settings");
}

/** A token made by hand, for a computer that can't open a browser (postrun login --with-token). Shown once. */
export async function makeToken(name: string): Promise<{ token?: string; error?: string }> {
  const v = await requireViewer("/settings");
  try {
    await enforce(LIMITS.tokenPerUser, v.id, "You've made a lot of tokens in the last hour.");
    const { token } = await createToken(v.id, name);
    revalidatePath("/settings");
    return { token };
  } catch (e) {
    if (e instanceof ShareError) return { error: e.message };
    throw e;
  }
}
