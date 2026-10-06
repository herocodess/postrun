"use server";

/** What the account pages can change. Each action checks who is signed in and only touches their own rows. */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { sendFeedbackAlert } from "@/lib/email";
import { adminEmails, baseUrl, isAdmin } from "@/lib/env";
import { readFeedback, saveFeedback, setFeedbackStatus } from "@/lib/feedback";
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

/** Feedback from the signed-in site. */
export async function sendFeedback(input: { rating?: number; message?: string }): Promise<{ ok?: true; error?: string }> {
  const v = await requireViewer("/feedback");
  try {
    await enforce(LIMITS.feedbackPerIp, `user:${v.id}`, "That's a lot of feedback in an hour. Thank you! Try again later.");
    const row = await saveFeedback(readFeedback({ ...input, source: "app", email: v.email }), v.id);
    after(() => sendFeedbackAlert(adminEmails(), row, `${baseUrl()}/admin#${row.id}`).catch((e: unknown) => console.error(e)));
    return { ok: true };
  } catch (e) {
    if (e instanceof ShareError) return { error: e.message };
    throw e;
  }
}

/** Admins only: mark a piece of feedback dealt with, or open again. */
export async function markFeedback(id: string, status: "new" | "done"): Promise<void> {
  const v = await requireViewer("/admin");
  if (!isAdmin(v.email) || (status !== "new" && status !== "done") || typeof id !== "string" || id.length > 32) return;
  await setFeedbackStatus(id, status);
  revalidatePath("/admin");
}
