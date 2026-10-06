"use client";

import { useTransition } from "react";
import { Loader } from "@postrun/brand/logo";
import { markFeedback } from "@/app/(account)/actions";

export function FeedbackStatus({ id, status }: { id: string; status: "new" | "done" }) {
  const [pending, start] = useTransition();
  const done = status === "done";
  return (
    <button type="button" className={`btn btn-sm ${done ? "btn-quiet" : "btn-ghost"} fb-status`} disabled={pending} onClick={() => start(() => markFeedback(id, done ? "new" : "done"))}>
      {pending ? <Loader size={14} inline label="Saving" /> : done ? "Reopen" : "Mark done"}
    </button>
  );
}
